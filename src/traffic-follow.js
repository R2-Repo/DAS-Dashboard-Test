/**
 * Microscopic car-following (IDM-style) along 1D road arc length.
 * Used by the traffic-first DAS simulator so vehicles do not pass through each other.
 */

export const DEFAULT_IDM = {
  maxAccelMps2: 1.8,
  comfortableDecelMps2: 2.4,
  jamDistanceM: 4.5,
  timeHeadwayS: 1.55,
  deltaExponent: 4,
  minBumperGapM: 0.6,
};

import { vehicleLengthM } from './vehicle-model.js';

export { vehicleLengthM };

/**
 * IDM acceleration (m/s²). No leader: free acceleration toward v0.
 * @param {number} vMps — current speed (m/s), nonnegative
 * @param {number} vLeadMps — leader speed (m/s), nonnegative
 * @param {number} gapM — bumper-to-bumper gap (m); use Infinity if no leader
 * @param {number} v0Mps — desired / free-flow speed cap (m/s)
 */
export function idmAccelerationMps2(vMps, vLeadMps, gapM, v0Mps, params = DEFAULT_IDM) {
  const a = params.maxAccelMps2;
  const b = params.comfortableDecelMps2;
  const s0 = params.jamDistanceM;
  const T = params.timeHeadwayS;
  const delta = params.deltaExponent;

  const v = Math.max(0, vMps);
  const v0 = Math.max(0.1, v0Mps);
  const vLead = Math.max(0, vLeadMps);

  const aFree = a * (1 - (v / v0) ** delta);

  if (!Number.isFinite(gapM) || gapM > 1e9) {
    return aFree;
  }

  if (gapM < 0) {
    return -b;
  }

  const s = Math.max(params.minBumperGapM, gapM);
  const sqrtAb = Math.sqrt(Math.max(1e-6, a * b));
  const deltaV = v - vLead;
  const sStar = s0 + Math.max(0, v * T + (v * deltaV) / (2 * sqrtAb));
  const aInteract = a * (sStar / s) ** 2;
  return aFree - aInteract;
}

/**
 * Sort lane vehicle indices by roadDistM ascending.
 */
export function sortIndicesByRoadDist(vehicles, indices) {
  return [...indices].sort((i, j) => vehicles[i].roadDistM - vehicles[j].roadDistM);
}

/**
 * For each vehicle index in a lane, compute { leaderIndex, gapM, vLeadMps } or null leader.
 * @param {number} fwd — +1 if forward motion increases roadDistM, else -1
 */
export function buildLaneFollowContext(vehicles, laneIndices, fwd) {
  const sorted = sortIndicesByRoadDist(vehicles, laneIndices);
  const n = sorted.length;
  const out = new Map();

  for (let k = 0; k < n; k++) {
    const i = sorted[k];
    let leaderIndex = null;
    if (fwd > 0 && k < n - 1) leaderIndex = sorted[k + 1];
    if (fwd < 0 && k > 0) leaderIndex = sorted[k - 1];

    if (leaderIndex === null) {
      out.set(i, { leaderIndex: null, gapM: Infinity, vLeadMps: 0 });
      continue;
    }

    const vFollow = vehicles[i];
    const vLead = vehicles[leaderIndex];
    const lenF = vehicleLengthM(vFollow.vehicleType);
    const lenL = vehicleLengthM(vLead.vehicleType);
    const ds = Math.abs(vLead.roadDistM - vFollow.roadDistM);
    const gapM = ds - 0.5 * (lenF + lenL);
    const vLeadMps = (vLead.speedMph ?? 0) * 0.44704;

    out.set(i, { leaderIndex, gapM, vLeadMps });
  }

  return out;
}

/** Clamp follower center position so bumpers do not overlap leader (1D along-lane). */
export function clampFollowerCenterBehindLeader(
  followerRoadM,
  followerType,
  leaderRoadM,
  leaderType,
  fwd,
  minBumperGapM,
) {
  const lenF = vehicleLengthM(followerType);
  const lenL = vehicleLengthM(leaderType);
  const minCenter = leaderRoadM - fwd * (0.5 * lenF + 0.5 * lenL + minBumperGapM);
  if (fwd > 0 && followerRoadM > minCenter) return minCenter;
  if (fwd < 0 && followerRoadM < minCenter) return minCenter;
  return followerRoadM;
}

/**
 * One integration step: IDM acceleration, speed update, position along lane.
 * @param {object} vehicle — mutates roadDistM, speedMph
 * @param {object|null} leaderVehicle — vehicle ahead in travel direction (same lane)
 * @param {number} fwd — +1 if forward motion increases roadDistM
 */
export function stepVehicleIdm(
  vehicle,
  leaderVehicle,
  desiredMph,
  curveCapMph,
  fwd,
  dtS,
  idmParams = DEFAULT_IDM,
) {
  if (vehicle.userLock) {
    return;
  }

  const desiredMps = Math.max(0, desiredMph) * 0.44704;
  const curveCapMps = Math.max(0.1, curveCapMph) * 0.44704;
  const v0 = Math.min(desiredMps, curveCapMps);

  let gapM = Infinity;
  let vLeadMps = 0;
  if (leaderVehicle) {
    const lenF = vehicleLengthM(vehicle.vehicleType);
    const lenL = vehicleLengthM(leaderVehicle.vehicleType);
    const ds = Math.abs(leaderVehicle.roadDistM - vehicle.roadDistM);
    gapM = ds - 0.5 * (lenF + lenL);
    vLeadMps = (leaderVehicle.speedMph ?? 0) * 0.44704;
  }

  const vMps = (vehicle.speedMph ?? 0) * 0.44704;
  let acc = idmAccelerationMps2(vMps, vLeadMps, gapM, v0, idmParams);
  acc = Math.max(-8, Math.min(idmParams.maxAccelMps2, acc));

  let vNew = vMps + acc * dtS;
  vNew = Math.max(0, vNew);

  let s = vehicle.roadDistM + fwd * vNew * dtS;

  if (leaderVehicle) {
    s = clampFollowerCenterBehindLeader(
      s,
      vehicle.vehicleType,
      leaderVehicle.roadDistM,
      leaderVehicle.vehicleType,
      fwd,
      idmParams.minBumperGapM,
    );
  }

  vehicle.roadDistM = s;
  vehicle.speedMph = vNew / 0.44704;
}
