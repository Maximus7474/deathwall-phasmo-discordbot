import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
    const restrictions = [
        { title: "No Flashlights", occurences: 1, description: "Investigation must be done in the dark or with room lights." },
        { title: "Broken Sprint", occurences: 1, description: "No use of the sprint key allowed." },
        { title: "Radio Silence", occurences: 1, description: "You've forgotten to charge your radios, you need to be together to talk." },
        { title: "Candlelight Only", occurences: 1, description: "Firelights are the only allowed light source." },
        { title: "Single Trip", occurences: 2, description: "Once you step outside the truck, you cannot go back in (only for one round)." },
        { title: "Forgotten Item", occurences: 4, description: "You've forgotten to restock on a random item, you'll have to work without it." },
        { title: "Shy Ghost", occurences: 3, description: "The ghost will share one less evidence, it really doesn't want to be found." },
        { title: "Athletic Ghost", occurences: 3, description: "The ghost seems to have been an athlete, it's 25% faster !" },
        { title: "Untrained Hunters", occurences: 2, description: "You were told to go to the gym, you've lost 25% sprint capacity!" },
        { title: "Blackout", occurences: 1, description: "The country is in a total blackout, you can't use the lights in the house." },
        { title: "Lower Tier Items", occurences: 2, description: "You have to remove a tier level from your gear." },
        { title: "Random Map", occurences: 1, description: "Your driver has decided to drive where the dice tells him to go to." },
        { title: "Insane Hunters", occurences: 2, description: "You didn't attend therapy, start with less sanity." },
        { title: "Dodgy Medicine", occurences: 1, description: "Seems like you were scammed, your medication doesn't help you anymore." },
    ];

    const adminId = "SYSTEM_SEED";

    await Promise.all(
        restrictions.map((res) =>
            prisma.restriction.create({
                data: {
                    title: res.title,
                    description: res.description,
                    occurences: res.occurences,
                    addedBy: adminId,
                },
            })
        )
    );

    console.log(`Seed successful: ${restrictions.length} restrictions created.`);
}

seed();