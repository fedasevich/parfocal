import type { SavedLearner } from "./learner-state.ts";

export interface LearnerStatus {
  readonly count: number;
  readonly ready: boolean;
  readonly trained: boolean;
}

export interface LearnerTaught {
  readonly status: LearnerStatus;
  readonly ms: number;
}

export type LearnerRequest =
  | {
      readonly type: "open";
      readonly requestId: number;
      readonly dims: number;
      readonly classKeys: readonly string[];
      readonly saved: SavedLearner | null;
    }
  | {
      readonly type: "teach";
      readonly requestId: number;
      readonly key: string;
      readonly feature: Float32Array<ArrayBuffer>;
      readonly classKey: string;
    }
  | { readonly type: "forget"; readonly requestId: number; readonly key: string }
  | {
      readonly type: "predict";
      readonly requestId: number;
      readonly features: readonly Float32Array<ArrayBuffer>[];
    }
  | { readonly type: "save"; readonly requestId: number };

export type LearnerReply =
  | {
      readonly type: "opened";
      readonly requestId: number;
      readonly status: LearnerStatus;
      readonly restored: boolean;
    }
  | { readonly type: "taught"; readonly requestId: number; readonly taught: LearnerTaught }
  | { readonly type: "forgot"; readonly requestId: number; readonly taught: LearnerTaught }
  | {
      readonly type: "predicted";
      readonly requestId: number;
      readonly predictions: readonly (Float32Array<ArrayBuffer> | null)[];
    }
  | { readonly type: "saved"; readonly requestId: number; readonly saved: SavedLearner }
  | { readonly type: "failed"; readonly requestId: number; readonly message: string };
