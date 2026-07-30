class TestResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 1200,
            height: 600,
            x: 0,
            y: 0,
            top: 0,
            right: 1200,
            bottom: 600,
            left: 0,
            toJSON: () => ({})
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: []
        }
      ],
      this
    );
  }

  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: TestResizeObserver
});

Object.defineProperty(globalThis, "requestAnimationFrame", {
  value: (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
});

Object.defineProperty(globalThis, "cancelAnimationFrame", {
  value: (handle: number) => window.clearTimeout(handle)
});

