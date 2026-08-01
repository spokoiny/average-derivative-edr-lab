import { optimizeInitialization, optimizeTuning, runExperiment, type ExperimentParams } from "./simulation";

type Request = {
  kind: "run" | "initialize" | "tune";
  params: ExperimentParams;
};

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { kind, params } = event.data;
    const result = kind === "initialize"
      ? optimizeInitialization(params)
      : kind === "tune"
        ? optimizeTuning(params)
        : runExperiment(params);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "The simulation could not be completed." });
  }
};
