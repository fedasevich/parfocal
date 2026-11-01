import { createCn } from "cn/config";

export const kitFontSizes = [
  "label",
  "caption",
  "body-sm",
  "body",
  "lead",
  "title-sm",
  "title",
  "page-title",
  "display",
];

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: kitFontSizes }],
      rounded: [{ rounded: ["ctl", "zone"] }],
      shadow: [{ shadow: ["pop"] }],
    },
  },
});
