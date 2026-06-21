import React from 'react';
import { JSDOM } from 'jsdom';
import type { RenderResult } from '@testing-library/react';

let domInitialized = false;

function defineGlobal(name: PropertyKey, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

export function ensureDom(): void {
  if (domInitialized) {
    return;
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  defineGlobal('window', dom.window as unknown as Window & typeof globalThis);
  defineGlobal('document', dom.window.document);
  defineGlobal('navigator', dom.window.navigator as Navigator);
  defineGlobal('HTMLElement', dom.window.HTMLElement);
  defineGlobal('HTMLTextAreaElement', dom.window.HTMLTextAreaElement);
  defineGlobal('SVGElement', dom.window.SVGElement);
  defineGlobal('Node', dom.window.Node);
  defineGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  defineGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
    return dom.window.setTimeout(() => cb(Date.now()), 0);
  }) as typeof requestAnimationFrame);
  defineGlobal('cancelAnimationFrame', ((id: number) => {
    dom.window.clearTimeout(id);
  }) as typeof cancelAnimationFrame);
  defineGlobal('MutationObserver', dom.window.MutationObserver);
  defineGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  const htmlElementPrototype = dom.window.HTMLElement.prototype as typeof dom.window.HTMLElement.prototype & {
    attachEvent?: () => void;
  };
  if (!htmlElementPrototype.attachEvent) {
    Object.defineProperty(htmlElementPrototype, 'attachEvent', {
      configurable: true,
      value: () => {},
    });
  }

  domInitialized = true;
}

export function renderWithDom(ui: React.ReactElement): RenderResult {
  ensureDom();
  document.body.innerHTML = '';
  const { render } = require('@testing-library/react') as typeof import('@testing-library/react');
  return render(ui);
}

export function testingLibrary(): typeof import('@testing-library/react') {
  ensureDom();
  return require('@testing-library/react') as typeof import('@testing-library/react');
}
