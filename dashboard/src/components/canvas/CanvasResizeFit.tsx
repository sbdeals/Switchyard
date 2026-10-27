"use client";

import { useEffect, useRef, useState } from "react";
import {
  useNodesInitialized,
  useOnViewportChange,
  useReactFlow,
  useStore,
  useStoreApi,
  type ReactFlowState,
} from "@xyflow/react";
import { hasSignificantCanvasResize, shouldRefitCanvas, type CanvasSize } from "@/lib/canvas-layout";

const isDragging = (state: ReactFlowState) =>
  state.paneDragging || state.userSelectionActive || state.nodes.some((node) => node.dragging);

/** React Flow already observes its container; reuse those dimensions here. */
export function CanvasResizeFit() {
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const dragging = useStore(isDragging);
  const store = useStoreApi();
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const initialized = useNodesInitialized();
  const { fitView, getNodes, getViewport, viewportInitialized } = useReactFlow();
  const previousSize = useRef<CanvasSize | null>(null);

  useOnViewportChange({
    onStart: () => {
      movingRef.current = true;
      setMoving(true);
    },
    onEnd: () => {
      movingRef.current = false;
      setMoving(false);
    },
  });

  useEffect(() => {
    if (!viewportInitialized || !initialized || width <= 0 || height <= 0) return;
    const next = { width, height };
    if (!previousSize.current) {
      previousSize.current = next;
      return;
    }
    // Leave the resize pending until panning, zooming or dragging has ended.
    if (moving || dragging) return;
    const timer = window.setTimeout(() => {
      // A gesture may have started before React flushed the effect cleanup.
      const interacting = movingRef.current || isDragging(store.getState());
      if (interacting) return;
      const previous = previousSize.current!;
      // Keep the baseline across small changes so a gradual large resize counts.
      if (!hasSignificantCanvasResize(previous, next)) return;
      previousSize.current = next;
      if (shouldRefitCanvas({
        previous,
        next,
        nodes: getNodes(),
        viewport: getViewport(),
        interacting,
      })) {
        void fitView({ padding: 0.3, maxZoom: 1 });
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [width, height, moving, dragging, initialized, viewportInitialized, fitView, getNodes, getViewport, store]);

  return null;
}
