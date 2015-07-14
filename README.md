# ratom.js
Reactive values for Derived Data All The Way Down

## {greeting}, {name}!

```javascript
import {atom, derive, transact} from 'ratom'

// static constants
const greetings = {
  en: "Hello",
  de: "Hallo",
  es: "Hola",
  cn: "您好",
  fr: "Bonjour"
};

// applicaiton state
const countryCode = atom("en");
const name = atom("World");

// state derivation
const greeting = countryCode.derive(cc => greetings[cc]);
const message = derive`${greeting}, ${name}!`;

// side-effecting reaction
message.react(msg => console.log(msg)); // $> Hello, World!

// state change
countryCode.set("de"); // $> Hallo, World!
name.set("Dieter"); // $> Hallo, Dieter!

transact(() => {
  countryCode.set("fr");
  name.set("Étienne");
});

// $> Bonjour, Étienne!
```

## Rationale

Monolithic MV[whatever] frameworks tend to encourage keeping application state in disparate little mutable chunks, tightly coupled to the [whatever] bits. Think Angular Scopes, Ember Models, Knockout View Models, etc. Such frameworks typically have no story for keeping these little mutable state chunks in sync with each other, or even with the ground-truth M which is often behind some callback-heavy API wall. This is fine if your app is small and simple.

Alas, many small and simple apps eventually become large and complex apps. Likewise, large and complex apps invariably become larger and more complex. Working on such a project, one might find oneself coming to the conclusion that orchestrating state consistency across dozens of mutable interdependent components in the face of asynchronous everything and the inevitable ad-hoc cross-cutting concerns which don't jibe with the rigid authoritarian architectures you once imagined to be boundlessly flexible is extremely—*painfully*—difficult. Difficult. Lemon difficult.

The solution to this problem seems to be something involving 'unidirectional data flow', as popularized by Facebook's [Flux](https://facebook.github.io/flux/) architecture. But the most direct source of inspiration for this library is actually [re-frame](https://github.com/day8/re-frame). Specifically re-frame's README which is, in part, a remarkable and compelling discourse on the particular brand of Flux-ishness ratom.js aims to serve. So **go read the re-frame README**. For reals. Do it.

But because you're a busy person and I'm into the whole brevity thing, here's the tl;dr:

> Keeping disparate pieces of mutable state consistent is hard. Keeping one piece of immutable state consistent is a matter of course. Let's do the latter.

The goal of ratom.js is to make it easy to build complex applications around global immutable state.

## Comparison with Previous Work

The idea for, name of, and api nomenclature used in this library were directly inspired by [Reagent](https://github.com/reagent-project/reagent). Reagent credits the reactive atom idea to [Reflex](https://github.com/lynaghk/reflex) which in turn cites [Knockout's Observables](http://knockoutjs.com/documentation/observables.html). Another high-quality ClojureScript solution is [javelin](https://github.com/tailrecursion/javelin). The [silk.co](http://silk.co) engineering team [have apparently done something similar](http://engineering.silk.co/post/80056130804/reactive-programming-in-javascript) but it isn't publicly available AFAICT.

The key advantage ratom.js has over all the above is that it uses a novel\* mark-and-sweep algorithm for change propagation which provides two significant benefits:

- Fully automatic memory management. This makes the library ergonomic and practical to use on its own rather than as part of a framework.
- Extreme laziness. *Upstream of active reactions, no values are computed unless absolutely necessary*. This allows derivation graphs to incorporate short-circuiting boolean logic. Note also that no tradeoff is made with regard to push-based flow; reactions are instantaneous and glitch-free.

Other advantages which may not each apply to every project mentioned above include:

- It is a standalone library (jumping on the 'unix philosophy' bandwagon), not tied to a UI framework.
- It encourages a cleaner separation of concerns. e.g. decoupling pure derivation from side-effecting change listeners.
- It has good taste, e.g. prohibiting cyclical updates (state changes causing state changes), dealing gracefully with 'dead' derivation branches, etc.

\* Well, the fact that a GC-esque mark-and-sweep algorithm is being used to propagate change in a FRP-ish value graph is novel, I'm pretty sure. I did a lot of digging.

## Model

There are three main types exposed by ratom.js:

- **Atoms** are mutable references but are intended to hold immutable, or effectively immutable, data.
- **Derivations** represent applications of pure functions to upstream values.
- **Reactions** are passive observers reacting to changes in atoms or derivations. Unlike the above, they do not encapsulate a value and exist solely for side-effects.

These three types are connected together in DAGs with atoms at the roots. The example at the top of this document can be depicted as follows:

<img src="https://raw.github.com/ds300/ratom.js/master/img/example.svg" align="center" width="89%"/>

It is often inappropriate for reactions to persist for the entire lifetime of your application. As such they can be manually started and stopped, and have two overridable lifecycle methods: `.onStart()` and `.onStop()` which can be used as hooks for acquiring and releasing resources associated with the reaction.

The one remaining type is **Lenses** which enable [Om](https://github.com/omcljs/om)-ish [cursors](https://github.com/omcljs/om/wiki/Cursors), among other fancy transformations. Lenses are derivations with one parent: either an atom or another lens. They abstract over the `get` and `set` operations of their parent, allowing one to modify part of a root atom without explicitly knowing the particulars of it's structure (that knowledge is encoded in the lenses themselves).

## Algorithms and Data Structures

#### Colors

All nodes in a DDATWDDAG (Derived Data All The Way Down Directed Acyclic Graph... I think it'll catch on) have an associated color. There are four colors: **black**, **white**, **red**, and **green**.

Broadly speaking these mean the following:

* **Green:** This node needs evaluating.
* **White:** This node's value is up to date.
* **Red:** This node's value is up to date, but has changed during the current mark/sweep cycle.
* **Black:** This node's value is out of date, but doesn't necessarily need to be re-evaluated.

But there are some extra subtleties so do read on.

#### Structures At Rest

An **atom** encapsulates the following data:

- Its color.
- Its current state.
- A set of direct children.

New atoms are **white** and have empty child sets.

A **derivation** encapsulates the following data:

- Its color.
- Its current state.
- A set of direct children.
- A set of direct parents.
- A deriving function. This calculates the derivation's current state in terms of one or more atoms or other derivations.

New derivations are **green** with empty child and parent sets.

A **reaction** encapsulates the following data:

- Its color.
- Its parent.
- Its activity status (active or inactive).
- A reacting function. This is called for side-effects each time the parent's value changes.

New reactions are **green** and inactive with their parent assigned.

#### Query

When an **atom** is dereferenced it simply returns its current state.

When a **derivation** is dereferenced its color is taken into consideration:

- **White** or **red**: Its current state is returned.
- **Green**: The derivation's deriving function is evaluated.

  This is done in a context which allows dereferences of direct parents to be monitored. Parent-child relationships are then set up by inserting the derivation into the child sets of the captured parents. Likewise, the set of captured parents becomes the derivation's parent set.

  If the derived value is equal to the derivation's current state, the derivation becomes **white** and it's current state is returned. Otherwise it becomes **red** while its current state becomes the newly-derived value. This value is then returned.

- **Black**: The child's parents are interrogated.

  If any of them are **red** the derivation must be re-evaluated as above. If any of the parents are **black** or **green** they are  dereferenced. If they then become **red**, the derivation must be re-evaluated as above. Otherwise all parents are **white** and therefore this derivation is set to **white** and it's current state is returned.

#### In Action

When a **reaction** is started, it becomes active and places itself in its parent's child set. It then dereferences the parent to ensure there is a bidirectional link between it (the reaction) and any upstream atoms.

When a reaction is stopped, it becomes inactive and removes itself from its parent's child set in order to sever this link.

#### In Action 2: Marking and Sweeping

When an **atom** is set, if the new value is equal to the current state, nothing happens.

Otherwise, the atom becomes **red**.

The atom's children are then traversed for the mark phase. If any of them are **white** or **red**, they are set to **black** and recursively traversed. Already-**black** children are not traversed. Any **reactions** which are encountered are placed in a queue. It is not possible to encounter **green** nodes at this stage, as **green** children have no consensual parents.

Once the mark phase is complete, the reaction queue is consumed, notifying the reactions that they may need to re-run themselves.

A reaction decides whether or not it needs to re-run by considering its parent's color. If the parent is **black** it is first dereferenced. Then, if the parent is **white**, it does not need to re-run. If the parent is **red** it does. It is not possible for the parent to be **green** at this stage, as **green** children have no consensual parents and atoms are never **green**.

Once all reactions have had a chance to re-run, the atom's children are again traversed in the sweep phase. If any encountered nodes are **white**, its children are not traversed. If any encountered nodes are **red**, they become **white** and traversal continues with their children. If any encountered nodes are **black**, they are removed from their parents' child sets and turned **green**. It is not possible to encounter **green** nodes during the sweep phase for the same reason as during the mark phase.

#### In Transaction



## API
