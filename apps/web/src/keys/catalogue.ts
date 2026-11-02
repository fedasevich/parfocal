import { keyActions } from "../screens/settings/keymap.ts";
import { createActionRegistry } from "./actions.ts";

export const keyRegistry = createActionRegistry(keyActions);
