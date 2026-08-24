/**
 * Benchmarks: comparing spending to something outside the ledger.
 *
 * Importing this registers the shipped providers. To replace or extend them,
 * call `registerBenchmarkProvider` before this module loads, or add to the
 * list below — later providers override earlier ones per category, so a
 * deployment can supply figures for a handful of categories without restating
 * the whole set. See docs/extending.md.
 */
export * from "./types";
import "./us";
