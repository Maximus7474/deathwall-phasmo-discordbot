import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
    const restrictions = [
        { id: "no_flashlights", occurences: 1, metadata: { item: 'flashlight' } },
        { id: "broken_sprint", occurences: 1, metadata: { sprint: false } },
        { id: "radio_silence", occurences: 1 },
        // { id: "candlelight_only", occurences: 1 }, removed
        { id: "single_trip", occurences: 2 },
        { id: "forgotten_item", occurences: 4, metatada: { forgottenItem: 1 } },
        { id: "shy_ghost", occurences: 3, metadata: { evidence: -1 } },
        { id: "athletic_ghost", occurences: 3, metadata: { entitySpeed: 25 } },
        { id: "untrained_hunters", occurences: 2, metadata: { playerSpeed: -25 } },
        { id: "blackout", occurences: 1, metadata: { breaker: false } },
        { id: "lower_tier_items", occurences: 2, metadata: { tier: -1 } },
        { id: "random_map", occurences: 1, metadata: { map: "random" } },
        { id: "insane_hunters", occurences: 2, metadata: { sanity: -25 } },
        { id: "dodgy_medicine", occurences: 1 },
        { id: "sole_copy", occurences: 3, metadata: { soleItem: 1 } },
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
                    metadata: res.metadata,
                },
            })
        )
    );

    console.log(`Seed successful: ${restrictions.length} restrictions created.`);
}

seed();