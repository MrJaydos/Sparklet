import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const categories = [
  { slug: "science", name: "Science", description: "Physics, chemistry, biology and the scientific method — how the universe actually works.", colorHex: "#38bdf8", icon: "🔬" },
  { slug: "history", name: "History", description: "Events, people and turning points that shaped the world.", colorHex: "#f59e0b", icon: "🏛️" },
  { slug: "psychology", name: "Psychology", description: "How minds work — cognition, behavior, biases and mental health.", colorHex: "#a78bfa", icon: "🧠" },
  { slug: "tech", name: "Tech", description: "Technology, engineering and the ideas behind the tools we use.", colorHex: "#22d3ee", icon: "⚙️" },
  { slug: "culture", name: "Culture", description: "Art, music, food, traditions and how humans express themselves.", colorHex: "#fb7185", icon: "🎭" },
  { slug: "money", name: "Money", description: "Economics, personal finance and how value moves through the world.", colorHex: "#34d399", icon: "💰" },
  { slug: "nature", name: "Nature", description: "Animals, plants, ecosystems and the living world.", colorHex: "#4ade80", icon: "🌿" },
  { slug: "space", name: "Space", description: "Astronomy, spaceflight and everything beyond the atmosphere.", colorHex: "#818cf8", icon: "🚀" },
  { slug: "health", name: "Health & Body", description: "Nutrition, sleep, exercise and how your body actually works.", colorHex: "#f472b6", icon: "🫀" },
  { slug: "language", name: "Language & Words", description: "Etymology, linguistics and surprising word origins.", colorHex: "#facc15", icon: "🗣️" },
  { slug: "philosophy", name: "Philosophy & Ideas", description: "Thought experiments, ethics and big ideas explained simply.", colorHex: "#c084fc", icon: "💭" },
  { slug: "code", name: "Code", description: "Programming, computer science and hacker lore.", colorHex: "#2dd4bf", icon: "💻" },
];

async function main() {
  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description, colorHex: c.colorHex, icon: c.icon },
      create: c,
    });
  }
  console.log(`Seeded ${categories.length} categories.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
