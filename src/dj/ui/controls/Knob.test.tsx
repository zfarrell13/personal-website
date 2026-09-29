// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Fader } from './Fader';
import { Knob } from './Knob';
import { LedButton } from './LedButton';

afterEach(cleanup);

describe('Knob', () => {
  it('drags up to increase and snaps to the centre detent', () => {
    const onChange = vi.fn();
    render(<Knob label="HI" value={0.5} onChange={onChange} />);
    const k = screen.getByRole('slider', { name: 'HI' });
    fireEvent.pointerDown(k, { pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 260 });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.7, 6));
    onChange.mockClear();
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 299 }); // 0.505 → detent → 0.5 == value → no change
    expect(onChange).not.toHaveBeenCalled();
  });
  it('double-click resets to the default', () => {
    const onChange = vi.fn();
    render(<Knob label="TRIM" value={0.9} onChange={onChange} defaultValue={0.5} />);
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'TRIM' }));
    expect(onChange).toHaveBeenCalledWith(0.5);
  });
});

describe('Knob pointer handling', () => {
  const setup = (extra = {}) => {
    const onChange = vi.fn();
    render(<Knob label="HI" value={0.2} onChange={onChange} {...extra} />);
    return { onChange, k: screen.getByRole('slider', { name: 'HI' }) };
  };
  it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)('stops dragging on %s', (ev) => {
    const { onChange, k } = setup();
    fireEvent.pointerDown(k, { pointerId: 1, clientY: 300 });
    fireEvent[ev](k, { pointerId: 1 });
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 200 });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('ignores a second pointer while one is dragging', () => {
    const { onChange, k } = setup();
    fireEvent.pointerDown(k, { pointerId: 1, clientY: 300 });
    fireEvent.pointerDown(k, { pointerId: 2, clientY: 100 });
    fireEvent.pointerMove(k, { pointerId: 2, clientY: 0 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(k, { pointerId: 2 }); // other finger lifting must not end pointer 1's drag
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 280 });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.3, 6));
  });
  it('SHIFT drags 10x finer and toggling SHIFT mid-drag does not jump', () => {
    const { onChange, k } = setup();
    fireEvent.pointerDown(k, { pointerId: 1, clientY: 300, shiftKey: true });
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 200, shiftKey: true }); // 100 px -> 0.05
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.25, 6));
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 200, shiftKey: false }); // rebased, same spot
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.25, 6));
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 180, shiftKey: false }); // 20 px coarse -> +0.1
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.35, 6));
  });
  it('wheel adjusts 2 % (0.2 % with SHIFT)', () => {
    const { onChange, k } = setup();
    fireEvent.wheel(k, { deltaY: -100 });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.22, 6));
    fireEvent.wheel(k, { deltaY: -100, shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.202, 6));
  });
  it('snaps to the detent within +/-2 %', () => {
    const { onChange, k } = setup({ value: 0.6, defaultValue: 0.5 });
    fireEvent.pointerDown(k, { pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(k, { pointerId: 1, clientY: 320 }); // 0.6 - 0.1 = 0.5
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });
});

describe('LedButton', () => {
  it('fires press on pointer down and release on pointer up', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<LedButton label="CUE" onPress={onPress} onRelease={onRelease} lit blink="slow" testId="cue" />);
    const b = screen.getByTestId('cue');
    fireEvent.pointerDown(b, { pointerId: 1 });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    fireEvent.pointerUp(b, { pointerId: 1 });
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(b.getAttribute('data-lit')).toBe('true');
    expect(b.getAttribute('data-blink')).toBe('slow');
  });
});

describe('LedButton release handling', () => {
  it.each(['pointerCancel', 'lostPointerCapture'] as const)('releases on %s, once', (ev) => {
    const onRelease = vi.fn();
    render(<LedButton label="CUE" onRelease={onRelease} testId="b" />);
    const b = screen.getByTestId('b');
    fireEvent.pointerDown(b, { pointerId: 1 });
    fireEvent[ev](b, { pointerId: 1 });
    fireEvent.pointerUp(b, { pointerId: 1 });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
  it('does not double-release on up followed by lostpointercapture', () => {
    const onRelease = vi.fn();
    render(<LedButton label="CUE" onRelease={onRelease} testId="b" />);
    const b = screen.getByTestId('b');
    fireEvent.pointerDown(b, { pointerId: 1 });
    fireEvent.pointerUp(b, { pointerId: 1 });
    fireEvent.lostPointerCapture(b, { pointerId: 1 });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe('multi-touch', () => {
  it('holds a button with one finger while dragging a fader and a knob with others', () => {
    const onRelease = vi.fn();
    const onFader = vi.fn();
    const onKnob = vi.fn();
    render(
      <>
        <LedButton label="JOG" onRelease={onRelease} testId="b" />
        <Fader label="F" value={0} onChange={onFader} length={100} />
        <Knob label="K" value={0.2} onChange={onKnob} />
      </>,
    );
    const track = screen.getByRole('slider', { name: 'F' });
    track.getBoundingClientRect = () => ({ top: 0, left: 0, width: 10, height: 100, right: 10, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(screen.getByTestId('b'), { pointerId: 1 });
    fireEvent.pointerDown(track, { pointerId: 2, clientY: 50 });
    fireEvent.pointerMove(track, { pointerId: 2, clientY: 20 });
    expect(onFader).toHaveBeenLastCalledWith(0.8);
    const k = screen.getByRole('slider', { name: 'K' });
    fireEvent.pointerDown(k, { pointerId: 3, clientY: 300 });
    fireEvent.pointerMove(k, { pointerId: 3, clientY: 280 });
    expect(onKnob).toHaveBeenLastCalledWith(expect.closeTo(0.3, 6));
    fireEvent.pointerUp(track, { pointerId: 2 });
    expect(onRelease).not.toHaveBeenCalled(); // button finger still down
    fireEvent.pointerUp(screen.getByTestId('b'), { pointerId: 1 });
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe('Fader', () => {
  it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)('stops dragging on %s and ignores other pointers', (ev) => {
    const onChange = vi.fn();
    render(<Fader label="CH1" value={0} onChange={onChange} length={100} defaultValue={0} />);
    const track = screen.getByRole('slider', { name: 'CH1' });
    track.getBoundingClientRect = () => ({ top: 0, left: 0, width: 10, height: 100, right: 10, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(track, { pointerId: 1, clientY: 50 });
    fireEvent.pointerMove(track, { pointerId: 2, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent[ev](track, { pointerId: 1 });
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it('double-click resets', () => {
    const onChange = vi.fn();
    render(<Fader label="CH1" value={0.9} onChange={onChange} defaultValue={0.2} />);
    fireEvent.doubleClick(screen.getByRole('slider', { name: 'CH1' }));
    expect(onChange).toHaveBeenCalledWith(0.2);
  });
});

describe('Fader jump', () => {
  it('jumps to a clicked position on the track', () => {
    const onChange = vi.fn();
    render(<Fader label="CH1" value={0} onChange={onChange} length={100} />);
    const track = screen.getByRole('slider', { name: 'CH1' });
    track.getBoundingClientRect = () => ({ top: 0, left: 0, width: 10, height: 100, right: 10, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(track, { pointerId: 1, clientY: 25 });
    expect(onChange).toHaveBeenCalledWith(0.75); // top = max
  });
});
