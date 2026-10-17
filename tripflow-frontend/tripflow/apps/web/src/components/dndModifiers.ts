import type { Modifier } from '@dnd-kit/core';

/** 只允许纵向拖动（避免引入额外依赖）。 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
