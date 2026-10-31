// library_pages.js - the TEXT of the in-game Library. Plain data: no code, so the same text can later become a wiki.
// To add a topic: add one object to PAGES. To change a topic: edit its body. Nothing else needs to change.
// order = the order in the topic list. blurb = the grey line under the title in the list.
// Body format (markdown, a small part of it):
//   a blank line starts a new paragraph or list
//   lines that start with "- " make a bullet list; lines that start with "1. " make a numbered list
//   **bold** and *italic* work inside a line
export const PAGES = [
  {
    id: 'start', title: 'How to use the Library', blurb: 'Start here',
    body: `**Welcome to the Library.** This is where the game is explained in plain words. Pick a topic from the list and tap to read it. The tours that run when you start only skim each screen, and the pages here go deeper. Come back any time you have a question.

If something still isn't clear, or you think a page is wrong, tell us on Discord. Everything is still being built and these pages will change as the game does.`,
  },
  {
    id: 'pilot', title: 'Your pilot', blurb: 'Level, XP, Cal, Endurance, credits',
    body: `**Who you are.** You are a Homo Sapiens Astroalis, a pilot bred for the dark of space and the strain of the G-Drive. The strain is real: your body pays for hard thrust, which is why Endurance exists. Other people call your kind Black-Eyes. Out here you are simply the people who can fly.

**The bars at the top.** These are always on screen:

- **Level and XP.** You earn XP by flying, fighting and completing missions. When you reach a new level, you get Calibrations (Cal) to spend on skills.
- **Endurance.** Thrust above your threshold drains it, and thrust at or below it, or being docked, refills it. The Flying page explains how it works.
- **Credits.** Everything in the system is bought and sold with them.

**Calibrations (Cal).** Cal are your skill points. You get them at every level-up, and you spend them in Skills to make yourself better at something. Unspent Cal don't expire, so you can save them while you decide.

**Your profile.** Tap your portrait circle to open your pilot file. It shows your level, Cal, credits, net worth (everything you own, added up), career, ship and reputation. Most of it is public, so other pilots can read it. The Skills button on this screen takes you to your skills.

**The Vacuum State button.** The VS button at the top left opens the Home page. It holds the Discord link for help and feedback, the terms and privacy page, your account and the game time, the Library and Log Out.

**Game time.** The game runs on one clock, for every pilot and every planet. One real minute is one game hour. Your Home page shows the game time.`,
  },
  {
    id: 'flying', title: 'Flying', blurb: 'Thrust, Endurance, the map',
    body: `**Why there are no brakes.** Your G-Drive burns no fuel. It creates a gravity well in front of the hull, and the ship falls into it. A moving ship in space keeps moving, so every trip works the same way: speed up to the halfway point, flip the ship around, then slow down by the same amount to stop at the far end.

**Thrust.** Thrust is measured in g (one g is the pull you feel standing on Earth). The slider on the right of the map sets it. More g means a shorter trip, but your body pays for it: thrust above your threshold, which is 3 g for a new pilot, drains your Endurance bar.

**Endurance.** Thrust above your threshold drains the bar. Flying at or below your threshold, or being docked, refills it. Tap the bar for a countdown. A pilot who stays at or below the threshold never runs out.

**Time and distance.** The planets orbit the Sun in real time, 60 times faster than normal, so one real minute is one game hour. Distances keep changing, which means the same trip can be short this week and long next week. Trip times are shown in real minutes, and they always use your current thrust.

**Using the map.** The zoom buttons are Inner (the inner planets), System (everything) and Ship (centers on you). You can also pan and zoom by touch. To fly, tap a location on the map, or open the destination list and tap a place there. Check the trip time, then press Launch. Tap the ship chip at the top right of the map to see your shield, armor and hull bars and what you have fitted.`,
  },
  {
    id: 'trading', title: 'Trading', blurb: 'Markets, prices, small lots',
    body: `**The basic rule.** Carry goods from where they are cheap to where they are wanted. Every place either produces a good, which raises its supply over time, or consumes it, which makes it valuable there. Prices follow supply and demand.

**Reading a market.** The columns are *Buy for* (what you pay), *Sell at* (what they pay you) and *Stock* (how many are on the shelf, with a % of the full supply amount). The gap between buy and sell is the house's cut, taken on every trade. A place will produce up to 150% of its full supply, which is a very good time to buy. Tap a column heading to sort, and tap it again to flip the order.

**The sections.**

- *Cargo* is your ship's hold.
- *Stored Here* is what you keep at this location.
- *Produced Here* lists what the place makes. Buy when the % under Stock is high.
- *Consumed Here* lists what the place uses up. Sell when the % is low, because it pays well.

**Trading from far away.** You can trade at any location, even one you aren't docked at, but a remote fee applies (10% at the start; the Proxy Broker skill lowers it). The prices shown already include it. Once docked, there is no fee. Goods bought remotely wait in Storage at that location until you dock there and load them, or have them shipped as freight.

**Before you buy.** Not every place buys every good. In the Produced Here heading, set the small place selector to your destination, and the list will show only goods that place trades. You can also press and hold a row to see its destinations.

**Small lots.** The price rises with every unit you buy, so small lots cost less per unit. Selling works the same way in reverse: every unit you sell adds to the location's stock and lowers the price, so small lots earn more per item. Try selling part of your load and putting the rest into Storage with the Unload button (at the top of the section; Unload all moves the whole hold). Sell it later, once the location has used up its stock.`,
  },
  {
    id: 'freight', title: 'Freight', blurb: 'Delivery contracts and hiring a hauler',
    body: `**What freight is.** Freight is a delivery contract: someone needs a load carried from one place to another, and pays you to do it. Unlike trading, you never put up money, and you never have to guess a price. Your pay is fixed when you accept.

**The Freight board.** At the bottom of the Market tab is the Freight section. It lists the contracts posted at the location you have selected. Only contracts that *start* at that place appear. If you don't see a Freight section, that location has no contracts to offer. Each line shows:

- how much cargo is still open, in CU (cargo units, the unit your hold is measured in)
- where it must be delivered
- the pay for each CU
- the bonus for each CU

**Taking a contract.**

1. Dock at the place where the contract starts. You can only accept a load while your ship is docked there.
2. Tap the contract and choose how many CU you want to carry. It starts at the most your hold can take, so change it if you want less. You can accept any number of CU, and the remainder stays on the board for you or another pilot.
3. Press Accept. The load goes into your hold, and your active loads are listed in your Cargo section.

**Delivering.** Fly to the delivery place the normal way. When your ship docks there, the freight is delivered by itself and you are paid. You don't need to do anything at the other end. Deliver early and you also earn the bonus.

**If you give up or run late.** If you give up the load, or its timer runs out, the contract is lost as if it had been cancelled. The load goes back on the board at its starting place, and you or another pilot can try again. Failing a contract will carry a reputation penalty in a later update.

**Hiring a hauler.** Goods you bought remotely wait in Storage at that location. Instead of flying there to collect them, you can hire another pilot to carry them. In Assets, use the Hire hauler button. The "Deliver to" list shows where the goods can go. You set the fee. The rules:

- You pay the fee, plus 10% extra. The extra 10% becomes the bonus for the hauler.
- Any bonus the hauler doesn't earn goes back to you.
- If you cancel the contract before a pilot has accepted it, the freight board keeps 1% of the fee.
- Once a pilot has accepted it, the contract can't be cancelled while it is being delivered.`,
  },
  {
    id: 'ships', title: 'Ships, rigs and refits', blurb: 'Hulls, slots, power, the shipyard',
    body: `**Your ship.** Every ship is a hull. The hull decides how big the hold is, how much power the reactor makes, and how many rig slots there are. Your first ship is a Courier, built for hauling. Other hulls are made for fighting or scouting, and some need a higher pilot level before you can buy them. There's also a limit on how many ships you can own, so sell one before you buy another once you reach it.

**Rigs.** A rig is a piece of equipment bolted to the hull. Weapons are one kind. The others are engineering rigs and utility rigs. A hull has a set number of slots for each kind, and a rig can only go in a slot of its own kind. Rigs are how you turn the same hull into a hauler, a fighter or a scout, so choose them for the job in front of you.

**Power.** Your reactor makes a fixed amount of power, and every rig uses some of it. The power bar on the Rigging screen shows what is used and what is free. If a rig needs more than is free, it can't be fitted until you take something else off.

**Hull limits.** Some rigs only fit certain hull classes. Weapons are also limited by size: a small hull can't mount a heavy weapon. If a rig is refused, the screen tells you the reason.

**Going below decks.** In Assets, touch a ship card to open its Rigging screen. At the top is the hull, where it is docked and what size of weapons it can mount. Under *Fitted* are the rigs installed, with a line for every empty slot. Below that are the rigs available at this place, from your Storage and from your hold. Touch **Fit** to install one. Touch **Take off** to remove one.

**Refits.** You can fit or remove rigs only while the ship is docked. Fitting a rig that is in Storage there is free, and so is taking it off. A rig you take off goes back into your Storage at that place, so you can refit the ship for whatever job comes next. Some rigs change the size of your hold, and you can't remove one if your cargo would no longer fit, so unload first.

**The Shipyard.** The Shipyard button on the Rigging screen opens the shipyard at that place. It's where you buy hulls and rigs, and where you sell what you don't need. Not every place has a shipyard. A rig you buy there can be fitted at once.`,
  },
  {
    id: 'skills', title: 'Skills', blurb: 'Calibrations and Grades',
    body: `**What skills are.** Skills are how a pilot grows. Each one makes you better at something, and you pay for them with Calibrations (Cal). To open the screen, go to your Profile and touch **Skills**.

**Getting Cal.** You earn 3 Cal at every level-up. Missions can reward you with Cal as well. Unspent Cal stay with you until you spend them.

**Reading the screen.** Your Cal are at the top: how many you can spend, how many you have earned in total, and how many you have spent. Below are four groups, each folded shut at first. Touch a group to open it:

- **Flight:** Endurance and trip time
- **Tactical:** weapons and maneuvering
- **Engineering:** ship hardware
- **Market:** trading

**Buying a skill.**

1. Touch a skill to open it. It explains what it does and what the next Grade gives you.
2. Each skill has several Grades, shown as bars. A skill at its top Grade says so.
3. Touch **Spend** and confirm. If you don't have enough Cal, the screen shows what the next Grade costs and how many you have.

**What a Grade costs.** The cost in Cal equals the Grade you are buying. Grade 1 costs 1 Cal, Grade 2 costs 2, Grade 3 costs 3, and so on. Each Grade adds to the one before, and the screen shows your new total before you pay.

**Dimmed skills.** A dimmed skill can't be bought yet. The note on it says why.

**Changing your mind.** Skills are permanent for now. A skill reset will be added in a future update, so you will be able to take your Cal back and spend them again.`,
  },
  {
    id: 'combat', title: 'Combat', blurb: 'Coming soon',
    body: `**Combat is coming.** This page will explain the combat screen, weapons and how fights work. Until then, the Missions tab shows the training missions that introduce combat, one step at a time.`,
  },
  {
    id: 'missions', title: 'Missions', blurb: 'Chains, rewards, claiming',
    body: `**What missions are.** Missions are jobs with a reward. Open them from the **Missions** tab at the bottom of the screen. A dot on the tab means a reward is waiting to be claimed, or a new mission has appeared that you haven't looked at yet.

**Chains.** Missions come in chains, which are groups of missions about one subject, such as pilot training or a faction. In a chain, the next mission becomes available only after you complete the one before it. Each chain is one card on the screen. Touch the card to fold it open or shut. Chains that have something for you to do open by themselves.

**How chains start.** A chain doesn't appear until something you do activates it. For example, arriving at a location can start one (arriving at Earth starts the Earth Space Command chain). Selling a certain amount of goods can start one, and so can fighting other ships. There are many more triggers, and new ones are added over time. If a chain isn't on your screen yet, you haven't done what starts it.

**What a mission shows.** Every mission has a title, a description, a list of steps and a reward. Steps are checked off by themselves as you complete them. A mission's status is one of:

- **Available:** waiting for you to press **Accept mission**.
- **In progress:** you've accepted it and the steps are running.
- **Ready to claim:** every step is done. Press **Claim reward** to be paid.
- **Done:** you've claimed the reward. Finished missions are kept under a **Completed** fold at the bottom of the chain.
- **Failed:** the mission was not completed.

**Rewards.** A reward can be credits, XP and Cal, in any mix. It is paid when you press **Claim reward**, not when the last step is done. The bigger prizes go beyond numbers: missions can give you access to special hulls, rigs and game options that you can't get any other way.

**Goals.** Missions ask for different things: carry a load, trade goods, travel to a place, fit a rig, or fight. Combat missions can ask you to deal damage to a type of ship, destroy a number of them, reach a location, or keep a ship alive until it gets there.

**Time limits.** Some missions have a time limit that starts when you accept them. You'll see it before you accept, and a countdown afterwards. If the time runs out, the mission fails.

**Failing.** Penalties for failing vary by mission. They can include a loss of reputation, a fine, or a cooldown timer that represents time in custody.

**The tutorial missions.** The first missions you see are training missions with a pointer that walks you through each screen. You can switch the pointer off, and the missions stay on the Missions screen to be done at your own pace. This Library is here for anything the tour skimmed over.`,
  },
];
