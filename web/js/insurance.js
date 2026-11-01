// insurance.js - the insurance popup after a ship is lost (migration 084).
// The server has already parked the lost ship at the default insurance place (Luna) and given the pilot a life pod.
// This popup asks where the ship should be delivered; for now Luna is the only place that offers insurance.
import { S, call, say, locName } from 'core';
import { modal, closeModal } from './coach.js';

let shownFor = null;                                   // the ship the popup is open for (so a refresh does not open it twice)

export function resetInsurance() { shownFor = null; }

async function choose(shipId, place) {
  closeModal();
  try {
    await call('insurance_choose', { ship: shipId, place: place.id });
    say('Delivered. Your policy remains in good standing.', 'ok');
    shownFor = null;
  } catch (e) {
    say('Error: ' + e.message, 'err');
    shownFor = null;                                   // the popup comes back with the next refresh
  }
  if (S.refresh) S.refresh();
}

export function checkInsurance() {
  const d = S.last;
  if (!d || !d.character) return;
  const ship = (d.ships || []).find(s => s.insurance_pending);
  if (!ship) { shownFor = null; return; }
  if (shownFor === ship.id) return;
  shownFor = ship.id;
  let places = (d.locations || []).filter(l => Array.isArray(l.svc) && l.svc.includes('insurance')).map(l => ({ id: l.id, name: l.name }));
  if (!places.length && ship.location_id) places = [{ id: ship.location_id, name: locName(ship.location_id) }];
  modal({
    kicker: 'LUNA UNDERWRITERS',
    title: 'Notice of Loss',
    paras: ['We regret to inform you that your vessel has been lost. The wreck has been recovered, repaired and fitted as it was. The cargo was not covered (see clause 9). Your pod is clear and drifting. Where shall we deliver the vessel?'],
    buttons: places.map(p => ({ label: p.name, onClick: () => choose(ship.id, p) })),
  });
}
