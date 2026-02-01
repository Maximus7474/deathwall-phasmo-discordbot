import { type Prisma, PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
    const restrictions: Omit<Prisma.RestrictionCreateInput, 'addedBy'>[] = [
        { id: "no_flashlights",          occurences: 1, score: 2, metadata: { item: 'flashlight' } },
        { id: "broken_sprint",           occurences: 1, score: 6, metadata: { sprint: false }      },
        { id: "radio_silence",           occurences: 1, score: 2                                   },
        { id: "single_trip",             occurences: 2, score: 8                                   },
        { id: "forgotten_item",          occurences: 4, score: 3, metadata: { forgottenItem: 1 }   },
        { id: "shy_ghost",               occurences: 3, score: 5, metadata: { evidence: -1 }       },
        { id: "athletic_ghost",          occurences: 3, score: 3, metadata: { entitySpeed: 25 }    },
        { id: "untrained_hunters",       occurences: 2, score: 4, metadata: { playerSpeed: -25 }   },
        { id: "blackout",                occurences: 1, score: 2, metadata: { breaker: false }     },
        { id: "lower_tier_items",        occurences: 2, score: 1, metadata: { tier: -1 }           },
        { id: "random_map",              occurences: 1, score: 4, metadata: { map: "random" }      },
        { id: "insane_hunters",          occurences: 2, score: 2, metadata: { sanity: -25 }        },
        { id: "dodgy_medicine",          occurences: 1, score: 2                                   },
        { id: "sole_copy",               occurences: 1, score: 5                                   },
        { id: "suspicious_contractors",  occurences: 1, score: 4                                   },
        { id: "no_hiding",               occurences: 1, score: 6                                   },
        { id: "restless_spirit",         occurences: 1, score: 5                                   },
        { id: "no_activity_monitor",     occurences: 1, score: 2                                   },
        { id: "no_sanity_monitor",       occurences: 1, score: 3                                   },
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