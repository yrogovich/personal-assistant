import type { GoalCategory, Measure } from "../../db/schema";

// v1 seed from VISION.md → "My goals" and GOALS.md. Written to Notion once, by the setup in Settings.
// After that Notion is the source of truth; edit goals there or on the Goals screen.

export type SeedGoal = {
  title: string;
  category: GoalCategory;
  priority: "main" | "secondary";
  why?: string;
  targetDate?: string;
  measure: Measure;
  habit?: { period: "week" | "month"; min: number; max: number };
  number?: { start: number; target: number; unit: string };
  steps?: [title: string, estimateMin: number][];
};

const repeat = (n: number, title: (i: number) => string, min: number): [string, number][] =>
  Array.from({ length: n }, (_, i) => [title(i + 1), min]);

export const SEED_GOALS: SeedGoal[] = [
  {
    title: "Post 2–3 reels a week about running and fitness, in Polish",
    category: "personal",
    priority: "main",
    measure: "habit",
    habit: { period: "week", min: 2, max: 3 },
  },
  {
    title: "Rebuild my CV",
    category: "work",
    priority: "main",
    targetDate: "2026-11-30",
    measure: "steps",
    steps: [
      ["List my roles from the last 5 years: company, dates, what I owned", 60],
      ["Pick 1–2 target roles and save 5 job posts I'd apply to", 45],
      ["Pull the repeated skills and keywords out of those posts", 30],
      ["Write 3–5 results per role, with numbers where possible", 90],
      ["Write the headline and a 3-line summary aimed at the target role", 30],
      ["Pick a clean template and lay it out on 1–2 pages", 60],
      ["Send to 1–2 people for feedback", 15],
      ["Apply feedback, export PDF", 45],
      ["Update LinkedIn profile to match the CV", 45],
    ],
  },
  {
    title: "Finish AI certifications",
    category: "work",
    priority: "main",
    why: "Claude Academy (academy.claude.com/courses): quiz + completion badge per course.",
    targetDate: "2026-11-30",
    measure: "steps",
    steps: [
      ["Claude 101: first half", 75],
      ["Claude 101: second half + quiz", 75],
      ["Claude Code 101 + quiz", 90],
      ["Claude Code in action + quiz", 60],
      ["Introduction to Model Context Protocol + quiz", 60],
      ...repeat(4, (i) => `AI Fluency: Framework and foundations, part ${i} of 4${i === 4 ? " + quiz" : ""}`, 60),
      ...repeat(9, (i) => `Building with the Claude API, part ${i} of 9`, 60),
      ["Add badges to CV and LinkedIn", 15],
    ],
  },
  {
    title: "Finish the design system course",
    category: "work",
    priority: "secondary",
    targetDate: "2026-12-31",
    measure: "steps",
    steps: [
      ...repeat(7, (i) => `Design system course: lesson ${i} of 7`, 120),
      ["Final task: read the brief and plan the work", 30],
      ["Final task: build", 90],
      ["Final task: polish and submit", 60],
      ["Add the project to portfolio and CV", 30],
    ],
  },
  {
    title: "Build a system that autoposts interesting things to LinkedIn without an obvious AI feel",
    category: "work",
    priority: "secondary",
    why: "Regular posts that sound like me. I approve every post before it goes out.",
    targetDate: "2026-12-31",
    measure: "steps",
    steps: [
      ["Define the audience and 3–4 topics I want to be known for", 45],
      ["Collect 10 posts I like and note why they work (hook, length, tone)", 60],
      ["Write 5 posts by hand to capture my voice", 90],
      ["Write a short style guide: phrases I use, phrases I never use", 45],
      ["Choose sources of interesting things (newsletters, RSS, notes, runs)", 45],
      ["Choose how to publish: LinkedIn API vs a scheduler like Buffer", 30],
      ["Build: collect sources → draft in my voice → I review → schedule", 90],
      ["Run for 2 weeks, track which posts land, adjust the style guide", 30],
    ],
  },
  {
    title: "Reach 80 kg",
    category: "fitness",
    priority: "secondary",
    why: "Supported by not skipping gym and runs and eating ~3000 kcal/day (tracked in Fitatu).",
    targetDate: "2027-02-28",
    measure: "number",
    number: { start: 74, target: 80, unit: "kg" },
  },
  {
    title: "Repair 2 teeth",
    category: "fitness",
    priority: "secondary",
    targetDate: "2026-12-31",
    measure: "steps",
    steps: [
      ["Choose a dentist and book a consultation", 15],
      ["Consultation: get the treatment plan and cost", 60],
      ["Book treatment for tooth 1", 10],
      ["Treatment: tooth 1", 60],
      ["Book treatment for tooth 2", 10],
      ["Treatment: tooth 2", 60],
      ["Follow-up visit, if the dentist asks for one", 30],
    ],
  },
  {
    title: "Read one book a month",
    category: "personal",
    priority: "secondary",
    measure: "habit",
    habit: { period: "month", min: 1, max: 1 },
  },
  {
    title: "Visit a country I've never been to",
    category: "personal",
    priority: "secondary",
    measure: "done",
  },
];
