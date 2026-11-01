const looks = {
  overview: "/mock-assets/overview.jpg",
  mid: "/mock-assets/mid-10x.jpg",
  hpf: "/mock-assets/hpf-40x.jpg",
} as const;

export type Look = keyof typeof looks;

const projectLooks: Record<string, { look: Look; spots: string[]; size: string }> = {
  P07: { look: "overview", spots: ["50% 30%", "40% 62%", "62% 48%", "35% 40%"], size: "170%" },
  P03: { look: "overview", spots: ["70% 70%", "30% 22%", "55% 85%", "45% 55%"], size: "150%" },
  P09: { look: "hpf", spots: ["20% 30%", "70% 60%", "45% 80%", "85% 20%"], size: "260%" },
  P11: { look: "mid", spots: ["30% 40%", "75% 55%", "50% 20%", "15% 80%"], size: "210%" },
  S01: { look: "overview", spots: ["50% 40%", "30% 70%", "65% 30%", "45% 50%"], size: "160%" },
};

export const lookUrl = (look: Look) => looks[look];

export function coverTile(projectCode: string, index: number) {
  const project = projectLooks[projectCode] ?? projectLooks["P07"];
  return {
    backgroundImage: `url(${looks[project?.look ?? "overview"]})`,
    backgroundPosition: project?.spots[index % 4] ?? "50% 50%",
    backgroundSize: project?.size ?? "170%",
    transform: index % 2 === 1 ? "scaleX(-1)" : undefined,
  };
}
