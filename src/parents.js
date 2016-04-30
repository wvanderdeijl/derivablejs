var parentsStack = [];

export function capturingParentsEpochs (f) {
  var i = parentsStack.length;
  parentsStack.push([]);
  try {
    f();
    return parentsStack[i];
  } finally {
    parentsStack.pop();
  }
};

export function captureParent (p) {
  if (parentsStack.length > 0) {
    var top = parentsStack[parentsStack.length - 1];
    top.push(p, 0);
    return top.length-1;
  } else {
    return -1;
  }
};

export function captureEpoch (idx, epoch) {
  if (parentsStack.length > 0) {
    parentsStack[parentsStack.length - 1][idx] = epoch;
  }
};