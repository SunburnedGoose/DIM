import { DestinyEnergyType } from 'bungie-api-ts/destiny2';
import { MAX_ARMOR_ENERGY_CAPACITY } from '../../search/d2-known-values';
import { ProcessItem, ProcessMod } from './types';

interface SortParam {
  energy?: {
    type: DestinyEnergyType;
    val: number;
  };
}

export interface ProcessItemSubset extends SortParam {
  id: string;
  compatibleModSeasons?: string[];
}

/**
 * This sorts process mods and items in the same manner as we try for greedy results.
 */
export function sortProcessModsOrItems(a: SortParam, b: SortParam) {
  if (a.energy && b.energy) {
    if (a.energy.type === b.energy.type) {
      return b.energy.val - a.energy.val;
    } else {
      return b.energy.type - a.energy.type;
    }
  } else if (!a.energy) {
    return 1;
  }

  return -1;
}

const noModsPermutations = [[null, null, null, null, null]];

function stringifyModPermutation(perm: (ProcessMod | null)[]) {
  let permString = '';
  for (const modOrNull of perm) {
    if (modOrNull) {
      permString += `(${modOrNull.energy?.type},${modOrNull.energy?.val},${modOrNull.tag || ''})`;
    }
    permString += ',';
  }
  return permString;
}

/**
 * This is heaps algorithm implemented for generating mod permutations.
 * https://en.wikipedia.org/wiki/Heap%27s_algorithm
 *
 * Note that we ensure the array length is always 5 so mods are aligned
 * with the 5 items.
 */
export function generateModPermutations(mods: ProcessMod[]): (ProcessMod | null)[][] {
  if (!mods.length) {
    return noModsPermutations;
  }
  const cursorArray = [0, 0, 0, 0, 0];
  const modsCopy: (ProcessMod | null)[] = Array.from(mods).sort(sortProcessModsOrItems);
  const containsSet = new Set<string>();

  while (modsCopy.length < 5) {
    modsCopy.push(null);
  }

  let i = 0;

  const rtn = [Array.from(modsCopy)];
  containsSet.add(stringifyModPermutation(modsCopy));

  while (i < 5) {
    if (cursorArray[i] < i) {
      if (i % 2 === 0) {
        [modsCopy[0], modsCopy[i]] = [modsCopy[i], modsCopy[0]];
      } else {
        [modsCopy[cursorArray[i]], modsCopy[i]] = [modsCopy[i], modsCopy[cursorArray[i]]];
      }
      const uniqueConstraint = stringifyModPermutation(modsCopy);
      if (!containsSet.has(uniqueConstraint)) {
        rtn.push(Array.from(modsCopy));
        containsSet.add(uniqueConstraint);
      }
      cursorArray[i] += 1;
      i = 0;
    } else {
      cursorArray[i] = 0;
      i += 1;
    }
  }

  return rtn;
}

function getEnergyCounts(modsOrItems: (ProcessMod | null | ProcessItemSubset)[]) {
  let arcCount = 0;
  let solarCount = 0;
  let voidCount = 0;

  for (const item of modsOrItems) {
    switch (item?.energy?.type) {
      case DestinyEnergyType.Arc:
        arcCount += 1;
        break;
      case DestinyEnergyType.Thermal:
        solarCount += 1;
        break;
      case DestinyEnergyType.Void:
        voidCount += 1;
        break;
    }
  }

  return [arcCount, solarCount, voidCount];
}

// Used for null values
const defaultModEnergy = { val: 0, type: DestinyEnergyType.Any };

/**
 * This figures out if all general, other and raid mods can be assigned to an armour set.
 *
 * The params generalModPermutations, otherModPermutations, raidModPermutations are assumed to be the results
 * from processUtils.ts#generateModPermutations, i.e. all permutations of general, other or raid mods.
 *
 * assignments is mutated by this function to store any mods assignments that were made.
 */
export function canTakeSlotIndependantMods(
  generalModPermutations: (ProcessMod | null)[][],
  otherModPermutations: (ProcessMod | null)[][],
  raidModPermutations: (ProcessMod | null)[][],
  items: ProcessItem[],
  assignments?: Record<string, number[]>
) {
  // Sort the items like the mods are to try and get a greedy result
  const sortedItems = Array.from(items).sort(sortProcessModsOrItems);

  const [arcItems, solarItems, voidItems] = getEnergyCounts(sortedItems);
  const [arcSeasonalMods, solarSeasonalMods, voidSeasonalMods] = getEnergyCounts(
    otherModPermutations[0]
  );
  const [arcGeneralMods, solarGeneralMods, voidGeneralMods] = getEnergyCounts(
    generalModPermutations[0]
  );
  const [arcRaidMods, solarRaidMods, voidRaidlMods] = getEnergyCounts(raidModPermutations[0]);

  // A quick check to see if we have enough of each energy type for the mods
  if (
    voidItems < voidGeneralMods ||
    voidItems < voidSeasonalMods ||
    voidItems < voidRaidlMods ||
    solarItems < solarGeneralMods ||
    solarItems < solarSeasonalMods ||
    solarItems < solarRaidMods ||
    arcItems < arcGeneralMods ||
    arcItems < arcSeasonalMods ||
    arcItems < arcRaidMods
  ) {
    return false;
  }

  otherModLoop: for (const otherP of otherModPermutations) {
    let othersFit = true;
    otherItemLoop: for (let i = 0; i < sortedItems.length; i++) {
      const otherMod = otherP[i];

      // If a mod is null there is nothing being socketed into the item so move on
      if (!otherMod) {
        continue otherItemLoop;
      }

      const item = sortedItems[i];
      const tag = otherMod.tag;
      const otherEnergy = otherMod.energy || defaultModEnergy;

      const noOtherMod = !otherP[i];
      const otherEnergyIsValid =
        item.energy &&
        item.energy.val + (otherEnergy.val || 0) <= MAX_ARMOR_ENERGY_CAPACITY &&
        (item.energy.type === otherEnergy.type || otherEnergy.type === DestinyEnergyType.Any);

      othersFit &&= Boolean(
        noOtherMod || (otherEnergyIsValid && tag && item.compatibleModSeasons?.includes(tag))
      );

      // The other mods wont fit in the item set so move on to the next set of mods
      if (!othersFit) {
        continue otherModLoop;
      }
    }

    generalModLoop: for (const generalP of generalModPermutations) {
      let generalsFit = true;
      generalItemLoop: for (let i = 0; i < sortedItems.length; i++) {
        const generalMod = generalP[i];

        // If a mod is null there is nothing being socketed into the item so move on
        if (!generalMod) {
          continue generalItemLoop;
        }

        const item = sortedItems[i];
        const generalEnergy = generalMod.energy || defaultModEnergy;
        const otherEnergy = otherP[i]?.energy || defaultModEnergy;

        const noGeneralMod = !generalP[i];
        const generalEnergyIsValid =
          item.energy &&
          item.energy.val + generalEnergy.val + otherEnergy.val <= MAX_ARMOR_ENERGY_CAPACITY &&
          (item.energy.type === generalEnergy.type || generalEnergy.type === DestinyEnergyType.Any);

        generalsFit &&= Boolean(noGeneralMod || generalEnergyIsValid);

        // The general mods wont fit in the item set so move on to the next set of mods
        if (!generalsFit) {
          continue generalModLoop;
        }
      }

      raidModLoop: for (const raidP of raidModPermutations) {
        let raidsFit = true;
        raidItemLoop: for (let i = 0; i < sortedItems.length; i++) {
          const raidMod = raidP[i];

          // If a mod is null there is nothing being socketed into the item so move on
          if (!raidMod) {
            continue raidItemLoop;
          }

          const item = sortedItems[i];
          const raidTag = raidMod.tag;
          const generalEnergy = generalP[i]?.energy || defaultModEnergy;
          const otherEnergy = otherP[i]?.energy || defaultModEnergy;
          const raidEnergy = raidMod.energy || defaultModEnergy;

          const raidEnergyIsValid =
            item.energy &&
            item.energy.val + generalEnergy.val + otherEnergy.val + raidEnergy.val <=
              MAX_ARMOR_ENERGY_CAPACITY &&
            (item.energy.type === raidEnergy.type || raidEnergy.type === DestinyEnergyType.Any);

          // Due to raid mods overlapping with legacy mods for last wish we need to ensure
          // that if an item has a legacy mod socket then another mod is not already intended
          // for this socket.
          const notLegacySocketOrLegacyMod = !item.hasLegacyModSocket || !otherP[i];

          raidsFit &&= Boolean(
            raidEnergyIsValid &&
              notLegacySocketOrLegacyMod &&
              raidTag &&
              item.compatibleModSeasons?.includes(raidTag)
          );

          // The raid mods wont fit in the item set so move on to the next set of mods
          if (!raidsFit) {
            continue raidModLoop;
          }
        }

        // Once we are finished looping through the items for the set of raid mods
        // we check to see if all three conditions are satisfied.
        if (raidsFit && generalsFit && othersFit) {
          if (assignments) {
            for (let i = 0; i < sortedItems.length; i++) {
              const generalMod = generalP[i];
              const otherMod = otherP[i];
              const raidMod = raidP[i];
              if (generalMod) {
                assignments[sortedItems[i].id].push(generalMod.hash);
              }
              if (otherMod) {
                assignments[sortedItems[i].id].push(otherMod.hash);
              }
              if (raidMod) {
                assignments[sortedItems[i].id].push(raidMod.hash);
              }
            }
          }

          return true;
        }
      }
    }
  }

  return false;
}
