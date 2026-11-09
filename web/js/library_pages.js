// library_pages.js - the TEXT of the in-game Library. Plain data: no code, so the same text can later become a wiki.
// To add a topic: add one object to PAGES. To change a topic: edit its body. Nothing else needs to change.
// order = the order in the topic list. blurb = the grey line under the title in the list.
// Body format (markdown, a small part of it):
//   a blank line starts a new paragraph, list, bar or picture
//   a line that starts with "## " is a BAR across the page that starts a new part (alone in its paragraph)
//   a line that is just  ![name|caption]  draws the picture 'name' from library_art.js, with the caption under it
//   lines that start with "- " make a bullet list; lines that start with "1. " make a numbered list
//   **bold** and *italic* work inside a line
export const PAGES = [
  {
    id: 'start', title: 'How to use the Library', blurb: 'Start here',
    body: `**Welcome to the Library.** This is where the game is explained in plain words. Pick a topic from the list and tap to read it. The tours that run when you start only skim each screen, and the pages here go deeper. Come back any time you have a question.

Pages are cut into parts, each with a bar across the top. Where a skill changes the numbers, the page ends with a **Skills** part that says how.

If something still isn't clear, or you think a page is wrong, tell us on Discord. Everything is still being built and these pages will change as the game does.`,
  },
  {
    id: 'pilot', title: 'Your pilot', blurb: 'Level, XP, Cal, Endurance, credits',
    body: `**Who you are.** You are a Homo Sapiens Astroalis, a pilot bred for the dark of space and the strain of the G-Drive. The strain is real: your body pays for hard thrust, which is why Endurance exists. Other people call your kind Black-Eyes. Out here you are simply the people who can fly.

## The bars at the top

These are always on screen:

- **Level and XP.** You earn XP by flying, fighting and finishing jobs. When you reach a new level, you get Calibrations (Cal) to spend on skills.
- **Endurance.** Thrust above your free thrust drains it, and thrust at or below it, or being docked, refills it. The Flying page explains how it works.
- **Credits.** Everything in the system is bought and sold with them.

## Calibrations

Cal are your skill points. You get 3 at every level-up, and jobs can pay them too. You spend them in Skills to make yourself better at something. Unspent Cal don't expire, so you can save them while you decide.

## Your profile

Tap your portrait circle at the top right to open your pilot file. At the top is your portrait with your Level, your Net worth (everything you own, added up), how long you have been a pilot and when you were last active. Then come these parts:

- **Pilot:** your XP, Calibrations and credits, and the **Skills** button. Only you see this part.
- **Career:** the distance you have flown, your trips, your trades and your freight deliveries.
- **Ship:** your hull, where it is, your hold size and your top thrust.
- **Reputation:** how the factions see you. It is not active yet.
- **Events** and **Activity log:** Events are public. The Activity log is only for you.

Other pilots can open your profile too, but they only see the public parts.

## The Vacuum State button

The VS button at the top left opens Home. It shows your pilot name, the game time and your account, a welcome note, and a Help list: the Library, Discord (for help and feedback), Terms and privacy, and Membership (not available yet). **Log out** is at the bottom.

## Game time

The game runs on one clock, for every pilot and every planet. One real minute is one game hour. Your Home page shows the game time.`,
  },
  {
    id: 'flying', title: 'Flying', blurb: 'Thrust, Endurance, the map',
    body: `**Why there are no brakes.** Your G-Drive burns no fuel. It makes a gravity well in front of the hull, and the ship falls into it. A moving ship in space keeps moving, so every trip works the same way: speed up to the halfway point, flip the ship around, then slow down by the same amount to stop at the far end.

## Thrust

Thrust is measured in **g**. One g is the pull you feel standing on Earth. There is no thrust slider any more: every flight asks for **your ship's top thrust**, which depends on the hull. More g means a shorter trip, but your body pays for it.

## Endurance and pulsing

Up to your **free thrust** (3 g for a new pilot) the G-Drive costs you nothing. Above it, flying drains your **Endurance** bar. So above the free thrust your flight **pulses**: the ship burns until about half the bar is gone, drops to the free thrust until the bar is full again, then burns again, for the whole trip. The trip list shows the **average** thrust that works out to. Docked, the bar refills faster still. Tap the bar for a countdown.

## Time and distance

The planets orbit the Sun in real time, 60 times faster than normal, so one real minute is one game hour. Distances keep changing, so the same trip can be short this week and long next week. Trip times are shown in real minutes.

## The Fly screen

The map fills the screen and the controls sit on top of it.

![fly_screen|The Fly screen: zoom and timers top left, your ship chip top right, Destinations and Launch at the bottom.]

- **Top left:** the zoom buttons **Inner** (the inner planets), **System** (everything) and **Ship** (centers on you). Under them are the timers of any timed job. Touch one to see which job it is for.
- **Top right:** your ship chip, with your shield, armor and hull bars. Touch it to open the ship menu.
- **Bottom:** the **Destinations** button and the **Launch** button. While you are flying, a small chip above them shows **Arrives in**.
- **On the map:** one finger moves it and two fingers zoom it. Other pilots show as points with their name and hull.

## Choosing a destination

Tap a place on the map, or open **Destinations** and tap a place in the list. The list is sorted by trip time. A place marked **near the Sun** is dangerous to fly to.

Picking a place is only a proposal. A blue line shows the course and the trip time is on the Launch button. Nothing happens until you press **Launch**.

## Changing your mind in flight

The same works while you fly. Pick a new destination and press **Confirm**. The server plans a new course from where the ship is, at the speed it has now. Pick the place you left, and the trip is cancelled.

## Combat zones

When your ship docks at a combat zone, the ship menu opens by itself, once for each stay. It has **Enter the zone** (or **Return to the zone**). At some ranges you choose which drone to fight, and the menu has an **Enter** button for each. If you close the menu, touch your ship chip at the top right to open it again. See the Combat page.

## Skills

- **Heavy Burn:** each Grade adds 5% to your hull's own top thrust, so trips are shorter.
- **G-Tolerant:** each Grade raises your free thrust by 0.2 g.
- **Dense Frame:** each Grade makes your Endurance bar 10% bigger.
- **Healing Factor:** each Grade makes Endurance refill 5% faster, flying or docked.`,
  },
  {
    id: 'trading', title: 'Trading', blurb: 'Markets, prices, the number box',
    body: `**The basic rule.** Carry goods from where they are cheap to where they are wanted. Every place makes some goods, which raises their supply, and uses others up, which makes them valuable there. Prices follow supply and demand.

## The price line

Every good at every place has a **base price** and a **full supply**. The **%** you see next to Stock is the shelf compared with that full supply.

- At 100% the price is the base price.
- Below 100% the price climbs as the shelf empties, and it is highest when the shelf is bare.
- Above 100% the price falls, and it is lowest at 150% and above.

Places keep making goods up to 150% of their full supply, so a high % is a good time to buy and a low % is a good time to sell. The shelf also changes by itself every minute as the place makes and uses goods.

## The cut

On top of the price, every trade pays a **spread** of 10% each way. You buy at the price plus 10% and you sell at the price minus 10%. A round trip therefore has to find at least 20% before you earn anything. Trading from far away adds a 10% **remote fee** (see below), so then you need about 30%.

## The price moves while you trade

Every unit you buy comes off the shelf, so the next unit costs more. Every unit you sell goes onto the shelf, so the next unit pays less. The price in a row is for the first unit. What you actually pay or get is the **average** over the whole lot. The line in the pop-up shows an estimate (the **~** price), and the confirmation box shows the exact figure from the server before anything happens.

Small lots cost less per unit when you buy and pay more per unit when you sell. A big lot moves the price against you.

## The number box

Touch a row to open its line: the **~** price each, a number box, and the buttons. Touching the box selects the whole number, so you can type straight over it. **All** fills in the most you can do.

![market_pop|A pressed Cargo row: 1 the ~ price each, 2 the number box, 3 All, 4 Sell, 5 Unload.]

The box starts with a suggested number:

- **Selling:** the number of units that would bring this place's shelf up to **50%** of its full supply, or everything you hold if that is fewer. If the place is already at 50% or more, the box starts at 0.
- **Buying:** the number of units that would take this place's shelf down to **80%** of its full supply (**90%** when you trade from far away). It never goes above what is on the shelf, what you can pay for, or, when you buy into the hold, what fits in the free hold space.

**Why those numbers.** They are the point where the price starts to work against you.

When you buy, each unit you take pushes the price up. Once the shelf is below 80%, the price has already climbed a long way, and you still pay the 10% spread on top, so the place where you sell has to pay a lot more than you paid. Below 80% it is hard to make any profit, and often there is none. From far away the remote fee takes another 10%, so the safe stopping point moves up to 90%.

When you sell, each unit you add pushes the price down. Past 50% the price you are getting has fallen well below what the first units earned, and you are also leaving the shelf full, so the place will pay little for the next while, to you and to every other pilot. Stopping at 50% keeps your units in the best part of the line. What is left can wait in Storage and be sold later, once the place has used its stock.

These are starting points, not rules. Your skills change the spread and the fee, so they change how far past the suggested number you can go and still earn (see Skills below).

## Reading the Market screen

Pick a place in the box at the top. Four sections follow:

- **Cargo:** your ship's hold.
- **Stored here:** what you keep at this place.
- **Produced here:** what the place makes. Buy when the % under Stock is high.
- **Consumed here:** what the place uses up. Sell when the % is low, because it pays well.

The columns:

- **Good:** in Cargo and Stored, the amount and the name, with what you paid for each underneath.
- **Best:** the other place with the best price for that good. For a good you carry, or one that is produced here, that is the place that pays the most. For a good that is consumed here, it is the place where it is cheapest to buy.
- **Price:** what the good costs here, or pays here. In Cargo and Stored it is the average for the whole pile, with your gain or loss against what you paid underneath (green is profit, red is a loss).
- **Stock:** how many are on the shelf, with the % of full supply.

Touch a column heading to sort, and touch it again to flip the order.

## The buttons

- **Sell** sells from your hold (Cargo) or from Storage (Stored here).
- **Unload** moves goods from the hold into Storage at this place. **Load** moves them from Storage into the hold, and **Full** fills the free hold space. You must be docked here to load.
- **Buy** buys into your hold or into Storage. The **To:** button switches between them.

Press and hold a row to see where else the good sells: the price and stock there, the profit for each unit, and the profit for each minute of flying.

## Trading from far away

You can trade at any place, even one you are not docked at, but a **remote fee** of 10% applies. The prices shown already include it. Once you are docked there is no fee. Goods bought from far away wait in Storage at that place until you dock there and load them, or have them hauled as freight.

## Skills

- **Hard Bargain:** each Grade takes 1 percentage point off the buy spread.
- **Spot Price:** each Grade takes 1 percentage point off the sell spread, so you get a better sell price.
- **Proxy Broker:** each Grade takes 1 percentage point off the remote fee. It never goes below zero.
- **Cubic Discipline:** each Grade adds 2% to your hull's own hold, so you can carry more of a good worth carrying.

At Grade 10 each of the first three removes its whole 10%.`,
  },
  {
    id: 'freight', title: 'Freight', blurb: 'Delivery contracts and hiring a hauler',
    body: `**What freight is.** Freight is a delivery contract: someone needs a load carried from one place to another, and pays you to do it. Unlike trading, you never put up money, and you never have to guess a price. Your pay is fixed when you accept.

## The Freight board

At the bottom of the Market tab is the **Freight** section. It lists the contracts posted at the place you have selected. Only contracts that *start* at that place appear. If you don't see a Freight section, that place has no contracts to offer. Each row shows:

- where the load must be delivered, and how much is still open, in CU (cargo units, the unit your hold is measured in), with the time window
- the pay for each CU, and under it the most bonus for each CU

## Taking a contract

1. Dock at the place where the contract starts. You can only accept a load while your ship is docked there.
2. Touch the contract. A line opens with a number box that starts at the most your hold can take, and **All**. Change the number if you want less. The rest stays on the board for you or another pilot.
3. Press **Accept**. The load goes into your hold, and your loads on board are listed in your Hold on the Assets screen.

## Delivering

Fly to the delivery place the normal way. When your ship docks there, the freight is delivered by itself and you are paid. You don't need to do anything at the other end. Deliver early and you also earn the bonus.

## If you give up or run late

If you give up the load (**Abandon** in your Hold), or its timer runs out, the contract is lost as if it had been cancelled. The load goes back on the board at its starting place, and you or another pilot can try again. Failing a contract will carry a reputation penalty in a later update.

## Hiring a hauler

Goods you bought from far away wait in Storage at that place. Instead of flying there to collect them, you can hire another pilot to carry them.

1. On the Assets screen, go to **Stored here** and touch the goods.
2. Press **Hire hauler**.
3. Choose **Deliver to**, the **Quantity** (**All** fills in everything you have) and the **Pay per CU**.
4. The box shows **Pay**, the **Bonus pool** and **You pay now**. Press **Post**.

The rules:

- You pay the fee, plus 10% extra. The extra 10% is the bonus pool, which is what the hauler earns for delivering early.
- Any bonus the hauler doesn't earn goes back to you.
- You can cancel a contract before a pilot has accepted it. Touch it in the Freight section of Assets and press **Cancel contract**. The board keeps 1% of the fee, and the rest comes back to you.
- Once a pilot has accepted it, the contract can't be cancelled while it is being delivered.

## Skills

- **Cubic Discipline:** each Grade adds 2% to your hull's own hold, so you can carry more CU on each trip.`,
  },
  {
    id: 'ships', title: 'Ships, rigs and refits', blurb: 'Hulls, slots, power, the Port',
    body: `**Your ship.** Every ship is a hull. The hull decides how big the hold is, how much power the reactor makes, and how many rig slots there are. Your first ship is a Courier, built for hauling. Other hulls are made for fighting or scouting, and some need a higher pilot level before you can buy them. There's also a limit on how many ships you can own, so sell one before you buy another once you reach it.

## Rigs

A rig is a piece of equipment bolted to the hull. Weapons are one kind. The others are engineering rigs and utility rigs. A hull has a set number of slots for each kind, and a rig can only go in a slot of its own kind. Rigs are how you turn the same hull into a hauler, a fighter or a scout, so choose them for the job in front of you.

## The rules for fitting

- **Slots.** One free slot of the right kind for each rig.
- **Power.** Your reactor makes a fixed amount of power, and every rig uses some of it. The power bar shows what is used and what is free. A rig that needs more than is free can't be fitted until you take something else off. A power amplifier adds power.
- **Hold.** Some rigs, such as a cargo expander, make your hold bigger. You can't take one off if your cargo would no longer fit, so unload first.
- **Hull class.** Some rigs only fit certain hull classes. Weapons are also limited by size: a small hull can't mount a heavy weapon.
- **Qualification.** Some rigs need you to have done something first.

If a rig is refused, the screen tells you the reason in a short red line.

## The Assets screen

Your ship card is at the top, with your Hold under it. Below are the **Hulls** you have parked at the chosen place, **Stored here** (rigs and goods you keep there) and **Freight**. Touch a ship card to open its Rigging screen.

## The Rigging screen

![rig_bar|Rigging: a changed row has an amber line on its side, and the bar at the bottom holds Reset and Apply.]

At the top is the hull, where it is docked and what size of weapons it can mount, with its **Max accel**, **Hold** and **Power used**. Under **Fitted** are the rigs installed, grouped by slot type, with a line for every empty slot. Under **Rigs and weapons here** are the rigs at this place, from your Storage and from your hold.

Touch **Fit** to install a rig, or **Take off** to remove one. The rig moves at once and the numbers change, but **nothing is saved yet**. Changed rows get an amber line on the side, and a bar at the bottom shows how many changes are waiting.

- **Apply** sends every change in one go. It is all or nothing: if the server refuses any of them, nothing changes, and the bar shows the reason and keeps your list.
- **Reset** throws the changes away.
- If you go **Back** with changes waiting, the button asks you to tap again to throw them away.

You can fit or remove rigs only while the ship is docked. A rig you take off goes into your Storage at that place, so you can refit the ship for whatever job comes next.

## The Port

The **Port** tab shows what you can do at the chosen place. Today that is the **Shipyard**. Not every place has one. You don't have to be there: what you buy goes into your Storage at that place, and what you sell is taken from it.

- **Assets** is the green part. It holds everything of yours that the place will buy: your parked hulls and your stored rigs. Prices in it are green.
- **Hulls**, **Weapons**, **Engineering rigs** and **Utility rigs** are what the place sells. Prices are amber. Weapons and rigs also show their **Power**.
- Touch a row to open it. For a hull you see its stats, the price and Buy. For a rig you see the price each, a number box, the total and Buy.
- A rig you buy while you are at the Shipyard from the Rigging screen can be fitted at once.

**Selling a hull.** Press the hull in Assets and then **Sell**. Its rigs and its cargo go into your Storage at that place by themselves, and then the hull is sold. You can't sell the ship you are flying.

## Skills

- **Cubic Discipline:** each Grade adds 2% to your hull's own hold. Hold added by rigs comes on top.
- **Gigawatt Savant:** each Grade adds 2% to your hull's power, which raises heat capacity and cooling. It does not add power for rigs.
- **Ceramic Applications:** each Grade adds 2% to your hull's own armor. Armor from rigs is not counted.`,
  },
  {
    id: 'skills', title: 'Skills', blurb: 'Calibrations, Grades and the full list',
    body: `**What skills are.** Skills are how a pilot grows. Each one makes you better at something, and you pay for them with Calibrations (Cal). To open the screen, go to your Profile and touch **Skills**.

## Getting Cal

You earn 3 Cal at every level-up. Jobs can reward you with Cal as well. Unspent Cal stay with you until you spend them.

## Reading the screen

At the top are your Cal: **Available** (what you can spend), **Earned** (the total) and **Spent**. Below are four groups, each folded shut at first. Touch a group to open it:

- **Flight:** Endurance and trip time
- **Tactical:** weapons and maneuvering
- **Engineering:** ship hardware
- **Market:** trading

## Buying a skill

1. Touch a skill to open it. It explains what it does and what the next Grade gives you.
2. Each skill has ten Grades, shown as small bars. A skill at its top Grade says so.
3. Press **Spend**. The button shows the cost. There is no second question, so opening the skill is your chance to change your mind.

If you don't have enough Cal, the screen shows what the next Grade costs and how many you have. A dimmed skill can't be bought yet. The note on it says why.

## What a Grade costs

The cost in Cal equals the Grade you are buying. Grade 1 costs 1 Cal, Grade 2 costs 2, Grade 3 costs 3, and so on, so a skill taken to Grade 10 costs 55 Cal in all. Each Grade adds to the one before, and the screen shows your new total before you pay.

## Changing your mind

Skills are permanent for now. A skill reset will be added in a future update, so you will be able to take your Cal back and spend them again.

## Skill review

What **one Grade** gives, and what you have at **Grade 10**.

**Flight**

- **Dense Frame:** Endurance bar +10% (Grade 10: +100%).
- **G-Tolerant:** free thrust +0.2 g (Grade 10: +2 g, so 5 g).
- **Healing Factor:** Endurance refills 5% faster, flying or docked (Grade 10: +50%).
- **Heavy Burn:** top thrust +5% of the hull's own (Grade 10: +50%).

**Tactical**

- **Thermal Bite:** laser damage +2% (Grade 10: +20%).
- **Collimator:** laser range +3% (Grade 10: +30%).
- **Hammerfall:** railgun damage +2% (Grade 10: +20%).
- **Dead Reckoning:** railgun range +3% (Grade 10: +30%).
- **Fourth State:** plasma damage +2% (Grade 10: +20%).
- **Gauss Cage:** plasma range +3% (Grade 10: +30%).
- **Brisance:** missile damage +2% (Grade 10: +20%).
- **Fuel Margin:** missile range +3% (Grade 10: +30%).
- **Twitch Vector:** maneuvering +2% (Grade 10: +20%).

**Engineering**

- **Aegis Weave:** shield recovery +0.75 a second (Grade 10: +7.5 a second).
- **Ceramic Applications:** hull armor +2% (Grade 10: +20%).
- **Gigawatt Savant:** power +2%, for heat capacity and cooling (Grade 10: +20%).
- **Cubic Discipline:** hold +2% (Grade 10: +20%).

**Market**

- **Hard Bargain:** buy spread 1 point lower (Grade 10: 10 points, no spread).
- **Spot Price:** sell spread 1 point lower (Grade 10: no spread).
- **Proxy Broker:** remote fee 1 point lower (Grade 10: no fee).`,
  },
  {
    id: 'combat', title: 'Combat', blurb: 'Zones, weapons, heat, losing a ship',
    body: `**Where it happens.** Combat takes place in **zones**, which the game calls the Vacuum. Fly to a combat zone, dock there, and press **Enter the zone** in the ship menu. If you close the menu, touch your ship chip on the Fly screen to open it again. Every zone has an escape edge, and any ship that crosses it leaves the zone and returns to the Main Map. The training range is run by ESC Range Control and is how you learn the basics.

## Shield, armor, hull

Damage goes through three layers in order: **shield**, then **armor**, then **hull**. Once all three are gone, so is the ship. Yours are the thin bars on the left edge of the screen. Every other ship has three small bars under its chip.

## The screen

![zone_screen|The zone screen: the map fills it, and everything else sits on top.]

- **Top left, the gear:** settings for this screen. The fight goes on if you hide it. Here you can turn the display of weapon ranges on or off and read the log of what has happened.
- **Top right:** the other ships on the range, as square chips. The nearest is at the right edge. Touch a chip, or the ship itself on the map, to open its menu.
- **Bottom right:** three chips: **heat**, **END** (endurance) and **zoom**. The zoom chip steps through Zone, Me, Target and Free.
- **Bottom row:** your weapons and rigs as square chips. The row scrolls sideways. Identical modules are one chip with a count.
- **On the map:** one finger moves it, two fingers zoom. **Double-tap empty space to thrust toward that point.**

## Orders

Touch a ship to open its menu.

- **Your own ship:** **Stop** and **Drift**. There is no friction out here, so start braking before you need to. Drift cuts the thrust and keeps your speed and direction.
- **A hostile ship:** **Set as target**, **Attack: long range** and **Attack: best range**. Attack orders fly you to that distance and fire. **Range** shows or hides that ship's weapon ranges on the map.
- **A friendly ship:** **Follow**. A friendly ship is never a target for your weapons.

## Weapons

- **Railgun (RG):** the standard weapon. Low heat, low power, good damage. Get into best range quickly, because accuracy drops off steeply.
- **Laser:** better damage than a railgun at long range, for high heat and high power. Not a beginner's choice.
- **Missile:** better damage than a railgun or laser at every range, unless the target has a point defense rig. It uses ammo, and ammo is finite.
- **Plasma:** huge damage at short range. Meant for large, slow targets such as freighters and bases. Hard to use in a dogfight.

Each weapon has a **best range** and a **longest range**. Accuracy and damage fall away outside the best range.

- Laser: best 125,000 km, longest 300,000 km
- Railgun: best 125,000 km, longest 240,000 km
- Plasma: best 75,000 km, longest 125,000 km
- Missile: best 240,000 km, longest 240,000 km
- Medium laser: best 150,000 km, longest 350,000 km

## Heat

Weapons and your engine make heat, and **cooling** takes it away. The **heat** chip shows the bar and the numbers:

- The engine makes heat only above your free thrust (3 g to start).
- Weapons **weaken above 80%** heat.
- At **100%** the ship shuts down until it cools below 60%.

Touching a module switches it on or off. A weapon that is off cannot overheat, and it cannot hit anything either. Modules that make no heat, such as armor plating, a power amplifier or a cargo expander, are always on.

## Endurance in a fight

The **END** chip is your endurance. **ON** lets the G-Drive burn as hard as your orders ask, at the cost of your endurance. **OFF** holds you to free thrust and lets your endurance recover. When it runs out, END switches to OFF by itself, and it cannot be switched on again until it is above 25%.

## When your ship is destroyed

When shield, armor and hull are all gone, the ship is lost, but you are not.

- **Insurance.** Your ship is insured. It comes back repaired and is parked at the insurance place, which for now is Luna. Its rigs stay fitted. A notice from Luna Underwriters tells you where it is waiting. There is no fee and no rig loss for now, while combat is still being balanced.
- **Cargo.** Everything in your hold is destroyed. Freight you were carrying is abandoned, and the contract goes back on its board.
- **The life pod.** You are put into a life pod. It drifts away from the zone with the speed and heading your ship had, and it can use only free thrust (3 g to start). A pod cannot be targeted and cannot enter a zone. Fly it to the insurance place the normal way, then board your repaired ship (Assets, Hulls).
- **Storage is safe.** Goods and rigs in Storage are never touched. Only the hold is lost.

## Skills

- **Thermal Bite, Hammerfall, Fourth State, Brisance:** each Grade adds 2% damage with lasers, railguns, plasma and missiles, in that order.
- **Collimator, Dead Reckoning, Gauss Cage, Fuel Margin:** each Grade adds 3% range with lasers, railguns, plasma and missiles.
- **Twitch Vector:** each Grade adds 2% to how fast the ship turns and maneuvers.
- **Aegis Weave:** each Grade adds 0.75 to shield recovery every second.
- **Ceramic Applications:** each Grade adds 2% to your hull's own armor.
- **Gigawatt Savant:** each Grade adds 2% to your power, which raises heat capacity and cooling. It does not change how much heat your engine makes.`,
  },
  {
    id: 'jobs', title: 'Jobs', blurb: 'Chains, rewards, claiming',
    body: `**What jobs are.** Jobs are tasks with a reward. Open them from the **Jobs** tab at the bottom of the screen. A dot on the tab means a reward is waiting to be claimed, or a new job has appeared that you haven't looked at yet.

## Chains

Jobs come in chains, which are groups of jobs about one subject, such as pilot training or a faction. In a chain, the next job becomes available only after you finish the one before it. Each chain is one bar on the screen. Touch the bar to fold it open or shut. The bars with something for you come first: a reward waiting, then a job available, then a job in progress. The right side of a bar says which, for example **1 ready to claim** or **2 available**.

## How chains start

A chain doesn't appear until something you do activates it. For example, arriving at a location can start one (arriving at Earth starts the Earth Space Command chain). Selling a certain amount of goods can start one, and so can fighting other ships. There are many more triggers, and new ones are added over time. If a chain isn't on your screen yet, you haven't done what starts it.

## What a job shows

Every job has a title, a description, a list of steps and a reward. Steps are checked off by themselves as you complete them: a green tick means it is done. A job's status is one of:

- **Available:** waiting for you to press **Accept job**.
- **In progress:** you've accepted it and the steps are running.
- **Ready to claim:** every step is done. Press **Claim reward** to be paid.
- **Done:** you've claimed the reward. Finished jobs are kept under a **Completed** fold at the bottom of the chain.
- **Failed:** the job was not completed.

## Rewards

A reward can be credits, XP and Cal, in any mix. It is shown in green at the bottom of the job. It is paid when you press **Claim reward**, not when the last step is done. The bigger prizes go beyond numbers: jobs can give you access to special hulls, rigs and game options that you can't get any other way.

## Goals

Jobs ask for different things: carry a load, trade goods, travel to a place, fit a rig, or fight. Combat jobs can ask you to deal damage to a type of ship, destroy a number of them, reach a location, or keep a ship alive until it gets there. A combat job asks for a weapon on your ship before you can accept it.

## Time limits and repeats

Some jobs have a time limit that starts when you accept them. You'll see it before you accept, and a countdown afterwards, and the same countdown shows as a chip on the Fly screen. If the time runs out, the job fails.

Some jobs come in **waves**: they are open for a while, then closed until the next wave. The job says how long is left. Jobs that repeat show how many times you have completed or failed them.

## Failing

Penalties for failing vary by job. They can include a loss of reputation, a fine, or a cooldown timer that represents time in custody.

## The tutorial jobs

The first jobs you see are training jobs with a pointer that walks you through each screen. You can switch the pointer off, and the jobs stay on the Jobs screen to be done at your own pace. This Library is here for anything the tour skimmed over.`,
  },
];
