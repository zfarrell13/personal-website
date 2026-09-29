// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DjProvider, type DjRuntime } from '../DjContext';
import { useDjStore } from '../store/djStore';
import { Settings } from './Settings';

const outputs = [
  { kind: 'audiooutput', deviceId: 'default', label: '' },
  { kind: 'audioinput', deviceId: 'mic', label: '' },
  { kind: 'audiooutput', deviceId: 'usb-hp', label: '' },
] as MediaDeviceInfo[];

function renderSettings() {
  const setHeadphoneDevice = vi.fn(async () => undefined);
  render(
    <DjProvider value={{ actions: { setHeadphoneDevice } } as unknown as DjRuntime}>
      <Settings />
    </DjProvider>,
  );
  return { setHeadphoneDevice };
}

beforeEach(() => {
  useDjStore.getState().reset();
  useDjStore.getState().setUi({ settingsOpen: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => outputs), getUserMedia: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
});

describe('<Settings>', () => {
  it('without setSinkId, explains SPLIT instead of offering a device picker', () => {
    renderSettings();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/Use SPLIT/)).toBeTruthy();
  });

  it('lists audio outputs (generic names until permission) and routes the headphones to the picked one', async () => {
    (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId = () => Promise.resolve();
    const { setHeadphoneDevice } = renderSettings();
    expect(await screen.findByRole('option', { name: 'Output 2' })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3); // off + two outputs (the mic is not listed)
    expect(screen.getByRole('button', { name: 'SHOW DEVICE NAMES' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Headphones output device' }), { target: { value: 'usb-hp' } });
    expect(setHeadphoneDevice).toHaveBeenCalledWith('usb-hp');
  });

  it('CLOSE hides the panel', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'CLOSE' }));
    expect(useDjStore.getState().ui.settingsOpen).toBe(false);
  });
});
