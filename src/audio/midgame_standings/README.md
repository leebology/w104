# midgame_standings

Plays **once, no loop**, on the host screen when the standings come up between
rounds.

**Empty is a real setting, and it is the one in use.** With no file in here the
`round_results/` track simply keeps playing from the reveal into the standings —
nothing is interrupted and nothing cuts to silence. Drop a file in and it takes
over instead, with nothing else to change.

The *final* standings are `endgame_standings/`, not this.
