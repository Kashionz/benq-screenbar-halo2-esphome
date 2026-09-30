import { MotionGlobalConfig } from "motion/react";

// jsdom has no layout or frames to animate; finish Motion animations at once
// so exiting elements leave the DOM as soon as React removes them.
MotionGlobalConfig.skipAnimations = true;
