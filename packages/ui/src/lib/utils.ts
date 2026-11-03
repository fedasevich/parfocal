import { typeStyles } from "@parfocal/tokens";
import { createCn } from "cn/config";

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: [...typeStyles] }],
      rounded: [{ rounded: ["ctl", "zone"] }],
      shadow: [{ shadow: ["pop"] }],
    },
  },
});
