export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => String(message).startsWith("Merge ")],
  rules: {
    "scope-case": [0],
    "subject-case": [0],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
