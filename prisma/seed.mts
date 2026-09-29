import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const TEMPLATES = [
  {
    name: "Cold intro — short",
    subject: "Quick question about {{company}}",
    description: "First touch. Short, one ask, no links.",
    body: `Hi {{firstName}},

I came across {{company}} and had a quick question — are you the right person to talk to about how you handle outbound right now?

If not, happy to be pointed elsewhere.

Best,
{{senderName}}`,
  },
  {
    name: "Follow-up — no reply",
    subject: "Following up",
    description: "Use with the 'no reply after 3 days' automation.",
    body: `Hi {{firstName}},

Floating this back to the top of your inbox in case it got buried.

Worth a short conversation, or should I close the loop?

{{senderName}}`,
  },
  {
    name: "Follow-up — opened, no reply",
    subject: "Anything useful here?",
    description: "Warmer nudge for contacts who opened but never answered.",
    body: `Hi {{firstName}},

I'll keep this to one line: is outbound something {{company}} is actively working on this quarter?

A yes or no is plenty.

{{senderName}}`,
  },
];

const AUTOMATIONS = [
  {
    name: "Follow up after 3 days",
    description: "No answer to the first email — send one polite nudge.",
    trigger: "NO_REPLY_AFTER_DAYS" as const,
    delayDays: 3,
    templateName: "Follow-up — no reply",
  },
  {
    name: "Nudge the openers",
    description: "Read it but never replied — one warmer touch a week later.",
    trigger: "OPENED_NO_REPLY" as const,
    delayDays: 7,
    templateName: "Follow-up — opened, no reply",
  },
];

async function main() {
  for (const template of TEMPLATES) {
    const existing = await prisma.template.findFirst({ where: { name: template.name } });
    if (existing) {
      console.log(`· template "${template.name}" already exists`);
      continue;
    }

    await prisma.template.create({ data: template });
    console.log(`+ template "${template.name}"`);
  }

  for (const automation of AUTOMATIONS) {
    const existing = await prisma.automation.findFirst({ where: { name: automation.name } });
    if (existing) {
      console.log(`· automation "${automation.name}" already exists`);
      continue;
    }

    const template = await prisma.template.findFirst({
      where: { name: automation.templateName },
    });
    if (!template) continue;

    const { templateName, ...rest } = automation;
    void templateName;

    await prisma.automation.create({
      data: { ...rest, templateId: template.id, isActive: false },
    });
    console.log(`+ automation "${automation.name}" (inactive)`);
  }

  console.log("\nDone. Automations are created paused — turn them on once you have reviewed them.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
