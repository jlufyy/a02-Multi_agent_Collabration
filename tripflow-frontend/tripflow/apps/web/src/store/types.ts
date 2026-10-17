import type {
  TripState, TripRequirements, RevisionProposal, PreparedContent, EventLogEntry, ParseResult, ValidationReport,
} from '@tripflow/contracts';
import type { EngineState } from '@tripflow/context-engine';

/** 一个“工作区”：真实旅行一份，演示运行另一份副本，两者互不污染。 */
export type Workspace = {
  plan?: TripState;                 // 已确认的正式计划（权威）
  undo: TripState[];                // 已确认快照栈
  redo: TripState[];
  pending?: PendingProposal;        // 唯一待确认草稿
  contents: PreparedContent[];
  eventLog: EventLogEntry[];        // 事实日志：不随撤销回滚
  geo: EngineState[];               // 每个活动的地理运行状态
};

export type PendingProposal = {
  proposal: RevisionProposal;
  origin: 'DRAG' | 'AI' | 'DETAIL' | 'NEARBY';
  createdAt: string;
  finalValidation?: ValidationReport;
};

export type LocalTrip = {
  tripId: string;
  createdAt: string;
  savedSeq: number;
  draft: {
    text: string;
    requirements?: TripRequirements;
    parse?: Pick<ParseResult, 'missingFields' | 'uncertainFields'>;
  };
  real: Workspace;
  demo?: Workspace & { demoRunId: string; startedAt: string; simClock: string };
};

export const UNDO_LIMIT = 20;
export const emptyWorkspace = (): Workspace => ({ undo: [], redo: [], contents: [], eventLog: [], geo: [] });
