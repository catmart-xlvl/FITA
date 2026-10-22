// Keep incremental repairs in order: a second rim correction depends on the
// interior removed by the first. Legacy placements stored only scleraPatch.
export function scleraPatches(run) {
 return run?.scleraPatches?.length ? run.scleraPatches : run?.scleraPatch ? [run.scleraPatch] : [];
}
