export const taskWindowName = "parfocal-study-task";

export const insideTaskWindow = () => {
  try {
    return window.name === taskWindowName;
  } catch {
    return false;
  }
};
