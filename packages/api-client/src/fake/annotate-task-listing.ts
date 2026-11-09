const annotateState = { blindFirst: true };

export const annotateBlindFirst = () => annotateState.blindFirst;

export const setAnnotateBlindFirst = (blindFirst: boolean) => {
  annotateState.blindFirst = blindFirst;
};
