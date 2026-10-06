import { sliderAtZoom, ZOOM_SLIDER_STEPS, zoomAtSlider } from '../src/react/view/zoom-slider.js';

describe('the photo zoom slider', () => {
  it('runs from the least zoom to the most', () => {
    expect(zoomAtSlider(0, 1, 4)).toBe(1);
    expect(zoomAtSlider(ZOOM_SLIDER_STEPS, 1, 4)).toBe(4);
    expect(zoomAtSlider(ZOOM_SLIDER_STEPS / 2, 1, 4)).toBe(2);
    expect(zoomAtSlider(-5, 1, 4)).toBe(1);
    expect(zoomAtSlider(ZOOM_SLIDER_STEPS + 5, 1, 4)).toBe(4);
  });

  it('moves less than a point of zoom per step around 100%', () => {
    expect(zoomAtSlider(1, 1, 4) - 1).toBeLessThan(0.01);
    const at = sliderAtZoom(1, 0.1, 4);
    expect(zoomAtSlider(at + 1, 0.1, 4) - zoomAtSlider(at, 0.1, 4)).toBeLessThan(0.01);
  });

  it('puts the thumb where the zoom is', () => {
    expect(sliderAtZoom(1, 1, 4)).toBe(0);
    expect(sliderAtZoom(2, 1, 4)).toBe(ZOOM_SLIDER_STEPS / 2);
    expect(sliderAtZoom(4, 1, 4)).toBe(ZOOM_SLIDER_STEPS);
    for (const position of [0, 37, 200, 399]) {
      expect(sliderAtZoom(zoomAtSlider(position, 0.1, 4), 0.1, 4)).toBe(position);
    }
  });

  it('rests at an end for a zoom the slider does not reach', () => {
    expect(sliderAtZoom(0.01, 0.1, 4)).toBe(0);
    expect(sliderAtZoom(8, 1, 4)).toBe(ZOOM_SLIDER_STEPS);
    expect(sliderAtZoom(0, 1, 4)).toBe(0);
    expect(sliderAtZoom(Number.NaN, 1, 4)).toBe(0);
  });
});
