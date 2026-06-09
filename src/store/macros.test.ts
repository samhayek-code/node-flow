/** Regression coverage for the pure macro-derivation lerp tables (macros.ts).
 *  Each macro fans out to a fixed set of base-param children; this pins the
 *  exact computed values at the v=0 / v=0.5 / v=1 endpoints so any drift in the
 *  lerp tables or rounding is caught. Values are derived by hand from the tables
 *  in macros.ts and confirmed against the actual float rounding (e.g.
 *  (2.25).toFixed(1) === "2.3", not "2.2"). */

import { describe, it, expect } from "vitest";
import { deriveMacro } from "./macros";

describe("deriveMacro", () => {
  describe("responsiveness", () => {
    // motionThreshold: lerp(0.14, 0.02, v).toFixed(3)
    // trailDecay:      r2(lerp(0.92, 0.4, v))
    // boxSmoothing:    r2(lerp(0.75, 0.05, v))
    it("returns the documented child keys", () => {
      expect(Object.keys(deriveMacro("responsiveness", 0.5)).sort()).toEqual(
        ["boxSmoothing", "motionThreshold", "trailDecay"].sort()
      );
    });

    it("v=0 endpoint", () => {
      expect(deriveMacro("responsiveness", 0)).toEqual({
        motionThreshold: 0.14,
        trailDecay: 0.92,
        boxSmoothing: 0.75,
      });
    });

    it("v=1 endpoint", () => {
      expect(deriveMacro("responsiveness", 1)).toEqual({
        motionThreshold: 0.02,
        trailDecay: 0.4,
        boxSmoothing: 0.05,
      });
    });

    it("v=0.5 midpoint", () => {
      expect(deriveMacro("responsiveness", 0.5)).toEqual({
        motionThreshold: 0.08,
        trailDecay: 0.66,
        boxSmoothing: 0.4,
      });
    });
  });

  describe("density", () => {
    // motionGrid:       Math.round(lerp(48, 200, v))
    // maxBlobs:         Math.round(lerp(4, 30, v))
    // connectorMaxDist: Math.round(lerp(120, 600, v))
    it("returns the documented child keys", () => {
      expect(Object.keys(deriveMacro("density", 0.5)).sort()).toEqual(
        ["connectorMaxDist", "maxBlobs", "motionGrid"].sort()
      );
    });

    it("v=0 endpoint", () => {
      expect(deriveMacro("density", 0)).toEqual({
        motionGrid: 48,
        maxBlobs: 4,
        connectorMaxDist: 120,
      });
    });

    it("v=1 endpoint", () => {
      expect(deriveMacro("density", 1)).toEqual({
        motionGrid: 200,
        maxBlobs: 30,
        connectorMaxDist: 600,
      });
    });

    it("v=0.5 midpoint", () => {
      // lerp(48,200,.5)=124; lerp(4,30,.5)=17; lerp(120,600,.5)=360
      expect(deriveMacro("density", 0.5)).toEqual({
        motionGrid: 124,
        maxBlobs: 17,
        connectorMaxDist: 360,
      });
    });
  });

  describe("boldness", () => {
    // pixelSize:      Math.round(lerp(2, 14, v))
    // boxWidth:       lerp(0.5, 4, v).toFixed(1)
    // connectorWidth: lerp(0.5, 3.5, v).toFixed(1)
    it("returns the documented child keys", () => {
      expect(Object.keys(deriveMacro("boldness", 0.5)).sort()).toEqual(
        ["boxWidth", "connectorWidth", "pixelSize"].sort()
      );
    });

    it("v=0 endpoint", () => {
      expect(deriveMacro("boldness", 0)).toEqual({
        pixelSize: 2,
        boxWidth: 0.5,
        connectorWidth: 0.5,
      });
    });

    it("v=1 endpoint", () => {
      expect(deriveMacro("boldness", 1)).toEqual({
        pixelSize: 14,
        boxWidth: 4,
        connectorWidth: 3.5,
      });
    });

    it("v=0.5 midpoint", () => {
      // pixelSize: round(8)=8
      // boxWidth: lerp(0.5,4,.5)=2.25 -> (2.25).toFixed(1)==="2.3" -> 2.3
      // connectorWidth: lerp(0.5,3.5,.5)=2 -> (2).toFixed(1)==="2.0" -> 2
      expect(deriveMacro("boldness", 0.5)).toEqual({
        pixelSize: 8,
        boxWidth: 2.3,
        connectorWidth: 2,
      });
    });
  });

  describe("size", () => {
    // boxScale: Math.round(v * 100)
    it("returns only boxScale", () => {
      expect(Object.keys(deriveMacro("size", 0.5))).toEqual(["boxScale"]);
    });

    it("v=0 endpoint", () => {
      expect(deriveMacro("size", 0)).toEqual({ boxScale: 0 });
    });

    it("v=1 endpoint", () => {
      expect(deriveMacro("size", 1)).toEqual({ boxScale: 100 });
    });

    it("v=0.5 midpoint", () => {
      expect(deriveMacro("size", 0.5)).toEqual({ boxScale: 50 });
    });
  });
});
