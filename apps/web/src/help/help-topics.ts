export type HelpTopic = { title: string; text: string };

export const helpTopics: readonly HelpTopic[] = [
  {
    title: "Upload slides and results",
    text: "Open a project and choose Upload. Files are grouped by case and slide, and each problem shows its fix before anything is sent.",
  },
  {
    title: "Review an AI result",
    text: "Open My work and press Continue. Agree with K, disagree with X and say what is wrong. Your review can change until the sign-off.",
  },
  {
    title: "Ask reviewers to check results",
    text: "From a project choose New review task, pick the slides and reviewers, and send it. Team shows how far each reviewer is.",
  },
  {
    title: "Find anything fast",
    text: "Press the command key with K to search actions, projects and slides from anywhere.",
  },
  {
    title: "Keys",
    text: "Press ? for the shortcut sheet. Every key can be changed there, and the QuPath and Figma sets are one choice away.",
  },
  {
    title: "Something is wrong",
    text: "Choose Send feedback in the account menu. It can attach a picture of the screen, and you choose whether to send it.",
  },
];
