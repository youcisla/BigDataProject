import type { Variants } from "framer-motion";

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

export const stagger = {
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

export const pulseDot = {
  scale: [1, 1.3, 1],
  opacity: [1, 0.7, 1],
  transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
};

export const shimmer = {
  backgroundPosition: ["200% 0", "-200% 0"],
  transition: { duration: 2.4, repeat: Infinity, ease: "linear" },
};

export const cardHover = {
  rest: { y: 0, scale: 1 },
  hover: { y: -2, scale: 1.005, transition: { duration: 0.2, ease: "easeOut" } },
};
