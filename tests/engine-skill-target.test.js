'use strict';
// The skill each profession-guide step starts at (Engine.GetSection(i).start), inferred from the section's `from` and
// the `craft … until` and `skill` goals before it: on every shipped profession guide for a character of each race and
// side, and pinned on an inline guide. Real Core manifest and shipped packs, stub world.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAddon } = require('./helpers/lua');
const { TEST_PACK, TEST_SOURCE } = require('./helpers/packs');

const PROFESSIONS = ['alchemy', 'blacksmithing', 'cooking', 'enchanting', 'engineering', 'first-aid', 'fishing', 'herbalism', 'leatherworking', 'mining', 'skinning', 'tailoring'];

const CHARACTERS = {
	Alliance: [['Human', 'WARRIOR'], ['Dwarf', 'ROGUE'], ['NightElf', 'DRUID'], ['Gnome', 'MAGE']],
	Horde: [['Orc', 'WARRIOR'], ['Scourge', 'ROGUE'], ['Tauren', 'DRUID'], ['Troll', 'MAGE']],
};

// Per character and guide: every step's section index, section range and start, from one sweep per faction.
function sweep(faction) {
	const lua = (list) => `{ ${list.map(([r, c]) => `{ "${r}", "${c}" }`).join(', ')} }`;
	return runAddon({
		stubs: ['stub_world.lua'],
		before: 'local w = stub.world\nw.level = 60',
		addons: ['Polestar', 'Polestar_Guides', `Polestar_Guides_${faction}`],
		saved: { Polestar: 'PolestarCharDB = { schema = 1 }' },
		login: true,
		script: `
local E, w = Polestar.Engine, stub.world
local out = {}
for _, rc in ipairs(${lua(CHARACTERS[faction])}) do
	w.race, w.raceName, w.class, w.className, w.faction = rc[1], rc[1], rc[2], rc[2], "${faction}"
	stub.advance(0.6)
	local byGuide = {}
	for _, name in ipairs({ ${PROFESSIONS.map((p) => `"${p}"`).join(', ')} }) do
		E.SetGuide("forever/professions/" .. name)
		local steps = {}
		for i = 1, E.GetStepCount() do
			local sec = E.GetSection(i)
			steps[#steps + 1] = sec and { i, sec.index, sec.from, sec.to, sec.start or false } or { i }
		end
		byGuide[name] = steps
	end
	out[rc[1] .. " " .. rc[2]] = byGuide
end
emit(out)`,
	}).emitted[0];
}

for (const faction of Object.keys(CHARACTERS)) {
	const swept = sweep(faction);
	for (const [character, guides] of Object.entries(swept)) {
		for (const name of PROFESSIONS) {
			test(`${character} (${faction}), ${name}: every step starts inside its section, never going back`, () => {
				const steps = guides[name].filter((s) => s.length > 1);
				assert.ok(steps.length > 0, 'the guide has sectioned steps');
				const forCharacter = new Set();
				const last = {};
				for (const [i, index, from, to, start] of steps) {
					if (start === false) continue;
					forCharacter.add(index);
					assert.ok(start >= from && start <= to, `step ${i}: start ${start} is outside section ${index} (${from}-${to})`);
					assert.ok(start >= (last[index] ?? 0), `step ${i}: start ${start} is below the previous step's ${last[index]} in section ${index}`);
					last[index] = start;
				}
				const sections = new Set(steps.map((s) => s[1]));
				for (const index of sections) assert.ok(forCharacter.has(index), `section ${index} has no step for ${character}`);
			});
		}
	}
}

test('inline guide: the start walks the section by its until crafts and skill goals, and skips another side\'s step', () => {
	const { emitted } = runAddon({
		stubs: ['stub_world.lua'],
		before: 'local w = stub.world\nw.race, w.raceName, w.faction, w.class, w.className, w.level = "Human", "Human", "Alliance", "WARRIOR", "Warrior", 60',
		addons: [{ name: 'Polestar', files: ['Core/Core.xml'] }],
		script: `${TEST_PACK}
${TEST_SOURCE}
local reagents = { { item = 2589, itemName = "Linen Cloth", count = 2 } }
Polestar.RegisterGuide({ id = "test/tailoring", pack = "test", title = "Tailoring", category = "Professions", minLevel = 1, maxLevel = 60,
	sections = { { skill = "Tailoring", skillLine = 197, from = 1, to = 75 } },
	steps = {
		{ title = "Bolts and belts", section = 1, goals = {
			{ t = "craft", spell = 2963, spellName = "Bolt of Linen Cloth", item = 2996, itemName = "Bolt of Linen Cloth", skillLine = 197, count = 7, reagents = reagents },
			{ t = "craft", spell = 2387, spellName = "Linen Belt", item = 2152, itemName = "Linen Belt", skillLine = 197, untilSkill = 15, yellow = 10, grey = 30, reagents = reagents },
		} },
		{ title = "Horde only", section = 1, only = { factions = { "Horde" } }, goals = {
			{ t = "craft", spell = 2387, spellName = "Linen Belt", item = 2152, itemName = "Linen Belt", skillLine = 197, untilSkill = 50, yellow = 10, grey = 30, reagents = reagents },
		} },
		{ title = "Up to 75", section = 1, goals = {
			{ t = "craft", spell = 2387, spellName = "Linen Belt", item = 2152, itemName = "Linen Belt", skillLine = 197, untilSkill = 75, yellow = 10, grey = 30, reagents = reagents },
			{ t = "skill", skill = "Tailoring", skillLine = 197, level = 75 },
		} },
		{ title = "Done", section = 1, goals = { { t = "level", level = 60 } } },
	} })
stub.login()
local E = Polestar.Engine
E.SetGuide("test/tailoring")
local out = {}
for i = 1, E.GetStepCount() do
	local sec = E.GetSection(i)
	out[i] = sec and (sec.start or false)
end
emit(out)`,
	});
	assert.deepEqual(emitted[0], [1, false, 15, 75]);
});
