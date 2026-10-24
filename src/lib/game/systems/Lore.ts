/** Inscriptions found on lore tablets around the world, keyed by structure anchor id. */
export const LORE: Record<string, { speaker: string; title: string; lines: string[] }> = {
	'lore-hollow': {
		speaker: 'Village Stone',
		title: 'Lumen Hollow',
		lines: [
			'"Here the lanterns were first lit against the long dusk, when the Seal was young and the Academy still sang."',
			'"Keep one burning for every traveller who has not come home."'
		]
	},
	'lore-crossroads': {
		speaker: 'Waymarker',
		title: 'The Three Roads',
		lines: [
			'West: the Eldergrove, where the trees remember. East: the Highlands, where the stars once fell. North: the Seal, and what it keeps.',
			'Someone has scratched beneath it: "Water carries lightning. Never forget it."'
		]
	},
	'lore-shrine': {
		speaker: 'Shrine Tablet',
		title: 'Verdance',
		lines: ['"The first Crystal was given to the forest, so that the Seal would always have roots."', '"Its keepers were wardens of bark and leaf. The corruption wears their faces now."']
	},
	'lore-grotto': {
		speaker: 'Hidden Inscription',
		title: 'A Smuggler\'s Note',
		lines: ['"If you are reading this, you found my hideaway. Good. The locket is yours. It kept me warm through three winters."']
	},
	'lore-spire': {
		speaker: 'Starfall Plinth',
		title: 'The Falling Star',
		lines: [
			'"A star fell here and did not go out. From its heart the Archmagi cut the third Crystal."',
			'"Winds still circle the spire. A fire caught in a whirlwind becomes a storm of flame."'
		]
	},
	'lore-academy': {
		speaker: 'Academy Charter',
		title: 'The Aether Academy',
		lines: [
			'"Let every student learn the four elements, and the harder lesson: that they answer one another."',
			'"Ice that is shattered by fire weeps. Ground that is struck while frozen breaks."'
		]
	},
	'lore-temple': {
		speaker: 'Temple Frieze',
		title: 'The Tyrant',
		lines: [
			'"Azrak was a warden of crystal, set to guard the Seal from below. In the long silence he grew hungry for the light he guarded."',
			'"When his heart cracks open, strike it. Even tyrants bleed light."'
		]
	},
	'lore-library': {
		speaker: 'Water-stained Folio',
		title: 'On Parrying',
		lines: [
			'"A ward raised a heartbeat before the blow lands turns the blow aside entirely, and the caster\'s own power floods back to them."',
			'"The Tyrant\'s stone fists cannot be turned so. Step aside instead."'
		]
	},
	'lore-crypt': {
		speaker: 'Undercroft Seal',
		title: 'Beneath the Throne',
		lines: ['"Beyond this arch sits the Crystal Throne. Those who enter do not leave until it is empty."']
	}
};
