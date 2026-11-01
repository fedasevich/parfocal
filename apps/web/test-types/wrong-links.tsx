import { Link } from "@tanstack/react-router";

export const wrongLinks = [
  <Link key="path" to="/projets/$projectId" />,
  <Link key="params" to="/projects/$projectId/slides/$slideId" params={{ projectId: "p" }} />,
  <Link
    key="search-type"
    to="/projects/$projectId/slides/$slideId"
    params={{ projectId: "p", slideId: "s" }}
    search={{ x: "left" }}
  />,
  <Link key="search-key" to="/my-work" search={{ view: "grid" }} />,
  <Link key="search-value" to="/my-work" search={{ tab: "everything" }} />,
];
