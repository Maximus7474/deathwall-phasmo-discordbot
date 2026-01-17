import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
    const restrictions = [
        { id: "no_flashlights", occurences: 1 },
        { id: "broken_sprint", occurences: 1 },
        { id: "radio_silence", occurences: 1 },
        { id: "candlelight_only", occurences: 1 },
        { id: "single_trip", occurences: 2 },
        { id: "forgotten_item", occurences: 4 },
        { id: "shy_ghost", occurences: 3 },
        { id: "athletic_ghost", occurences: 3 },
        { id: "untrained_hunters", occurences: 2 },
        { id: "blackout", occurences: 1 },
        { id: "lower_tier_items", occurences: 2 },
        { id: "random_map", occurences: 1 },
        { id: "insane_hunters", occurences: 2 },
        { id: "dodgy_medicine", occurences: 1 },
        { id: "sole_copy", occurences: 3 },
        { id: "suspicious_contractors", occurences: 1 },
    ];

    const adminId = "SYSTEM_SEED";

    await Promise.all(
        restrictions.map((res) =>
            prisma.restriction.create({
                data: {
                    id: res.id,
                    occurences: res.occurences,
                    addedBy: adminId,
                },
            })
        )
    );

    console.log(`Seed successful: ${restrictions.length} restrictions created.`);
}

seed();