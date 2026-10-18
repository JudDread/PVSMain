// rigtext.js - plain-words text shared by the rig screens (Facilities shipyard, Rigging). Display only: no server calls.
import { money, whole, r2 } from 'core';

export const KIND_LABEL = { weapon: 'Weapon', engineering: 'Engineering', utility: 'Utility' };
export const KIND_PLURAL = { weapon: 'Weapons', engineering: 'Engineering rigs', utility: 'Utility rigs' };

// The sentence for a refused or failed rig / shipyard action (the server answers with an error name and its numbers in e.data).
export function rigError(e) {
  const d = e.data || {}, m = e.message;
  const kind = KIND_LABEL[d.kind] ? KIND_LABEL[d.kind].toLowerCase() : 'matching';
  if (m === 'no_shipyard') return 'There is no shipyard at that place.';
  if (m === 'not_for_sale') return 'The shipyard does not sell that rig.';
  if (m === 'not_enough_credits') return 'Not enough credits (it costs ' + money(d.cost || 0) + ', you have ' + money(d.credits || 0) + ').';
  if (m === 'not_enough_stored') return 'You only have ' + (d.have || 0) + ' stored there.';
  if (m === 'bad_request') return 'That request was not valid. Quantities are whole numbers from 1 to 100.';
  if (m === 'unknown_rig') return 'That rig is not known.';
  if (m === 'bad_location') return 'That place is not known.';
  if (m === 'no_character') return 'You have no character yet.';
  if (m === 'no_ship') return 'You have no ship.';
  if (m === 'bad_ship') return 'That ship was not found.';
  if (m === 'is_pod') return 'A life pod has no slots.';
  if (m === 'not_docked') return 'The ship must be docked for that.';
  if (m === 'no_rig_here') return 'That rig is not in storage at the ship\'s place or in its hold.';
  if (m === 'not_fitted') return 'That rig is not fitted any more.';
  if (m === 'no_free_slot') return 'No free ' + kind + ' slot (this hull has ' + (d.slots || 0) + ').';
  if (m === 'over_power') return 'Not enough power: it needs ' + whole(d.need || 0) + ', only ' + whole(d.free || 0) + ' free.';
  if (m === 'over_power_after_removal') return 'Taking it off would leave the ship short of power (output ' + whole(d.output_after || 0) + ', needed ' + whole(d.used_after || 0) + ').';
  if (m === 'hold_too_small') return 'The hold would be too small: it would hold ' + r2(d.hold_after || 0) + ' and you carry ' + r2(d.hold_used || 0) + '. Unload some cargo first.';
  if (m === 'hull_class') return 'This rig only fits ' + (d.classes || []).join(' / ') + ' hulls (this is a ' + (d.hull_class || '?') + ' hull).';
  if (m === 'weapon_tier') return 'A ' + (d.hull_tier || '?') + ' hull cannot mount a ' + (d.rig_tier || '?') + ' weapon.';
  if (m === 'needs_qualification') return 'You have not earned the right to fit this rig yet.';
  if (m === 'server_error') return 'Server error. Check the function logs.';
  return 'Error: ' + m;
}
