export const tourMenuEvent = "app-tour-menu";

export const openTourMenu = () => window.dispatchEvent(new Event(tourMenuEvent));
