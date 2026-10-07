/* Numbers shown on the page, copied from the arXiv paper
 * (OmniHOI-arxiv/paper/sections/experiments.tex): tab:recon, tab:transfer,
 * tab:e2e.  Change them there first. */
window.OMNIHOI_RESULTS = {
  recon: {
    note: "Object F-score at 5 / 10 mm (F5, F10), object Chamfer distance (CD), hand vertex / joint error after Procrustes alignment (MPVPE, MPJPE), hand-object intersection volume (IV). 500 single-hand images per dataset.",
    metrics: [
      { key: "F5", label: "F5", better: "up", digits: 3 },
      { key: "F10", label: "F10", better: "up", digits: 3 },
      { key: "CD", label: "CD", unit: "cm²", better: "down", digits: 2 },
      { key: "MPVPE", label: "MPVPE", unit: "mm", better: "down", digits: 2 },
      { key: "MPJPE", label: "MPJPE", unit: "mm", better: "down", digits: 2 },
      { key: "IV", label: "IV", unit: "cm³", better: "down", digits: 2 },
    ],
    methods: ["EasyHOI", "FollowMyHold", "iHOI", "OmniHOI"],
    splits: {
      Overall: [
        [0.2187, 0.3890, 1.7110, 14.63, 14.02, 23.66],
        [0.2007, 0.3602, 1.7731, 8.92, 8.48, 19.73],
        [0.2158, 0.3881, 1.7384, 11.41, 10.88, 2.90],
        [0.3878, 0.5831, 0.9574, 6.05, 5.71, 2.75],
      ],
      ARCTIC: [
        [0.1720, 0.3067, 2.6391, 16.20, 15.43, 27.19],
        [0.1698, 0.3035, 2.6325, 10.69, 10.10, 28.30],
        [0.1741, 0.3137, 2.6672, 12.79, 12.07, 2.35],
        [0.2823, 0.4568, 1.6048, 5.36, 4.99, 2.64],
      ],
      DexYCB: [
        [0.2592, 0.4672, 0.7856, 12.93, 12.47, 28.57],
        [0.2127, 0.3890, 1.0262, 5.79, 5.60, 14.95],
        [0.2611, 0.4708, 0.8182, 10.50, 10.13, 3.31],
        [0.4875, 0.7159, 0.3436, 5.03, 4.88, 4.44],
      ],
      OakInk2: [
        [0.2300, 0.4013, 1.6193, 14.62, 14.02, 14.31],
        [0.2239, 0.3952, 1.5709, 10.21, 9.67, 14.91],
        [0.2159, 0.3865, 1.6404, 10.77, 10.29, 3.10],
        [0.4040, 0.5883, 0.8594, 7.94, 7.43, 1.09],
      ],
    },
  },
  transfer: {
    note: "150 motion-capture trajectories per hand (TACO, OakInk2, ARCTIC), replayed open-loop in MuJoCo. A task succeeds if the object's trajectory error stays below 10 cm and 0.5 rad. Errors take the worst object of each task, then the median over tasks. ManipTrans does not support Wuji Hand and SharpaWave.",
    hands: [
      { name: "Inspire Hand", dof: 6 },
      { name: "XHand", dof: 12 },
      { name: "Wuji Hand", dof: 20 },
      { name: "SharpaWave", dof: 22 },
      { name: "Shadow Hand", dof: 20 },
    ],
    methods: ["ManipTrans", "SPIDER", "OmniRetarget", "OmniHOI"],
    success: [[24, 22, null, null, 26], [26, 26, 20, 19, 15], [24, 31, 27, 20, 16], [39, 89, 86, 89, 85]],
    trans: [[9.4, 9.7, null, null, 10.7], [6.6, 6.2, 8.3, 8.1, 8.5], [8.4, 3.8, 6.4, 7.3, 8.1], [6.7, 1.8, 1.6, 1.5, 2.4]],
    rot: [[37, 33, null, null, 34], [43, 43, 43, 54, 45], [33, 35, 43, 46, 50], [26, 12, 11, 10, 14]],
    minutes: [385, 37, 0.3, 19],
  },
  e2e: {
    note: "60 monocular video clips (51 TACO, 9 OakInk2), XHand, same success criterion and error aggregation as above. Progress: mean fraction of the longest prefix that passes the criterion.",
    methods: ["VideoManip", "Do as I Do", "OmniHOI"],
    metrics: [
      { key: "succ", label: "Success", unit: "%", better: "up", values: [28, 25, 53], max: 100 },
      { key: "prog", label: "Progress", unit: "%", better: "up", values: [49, 48, 71], max: 100 },
      { key: "trans", label: "Translation error", unit: "cm", better: "down", values: [8.6, 9.1, 5.7], max: 10 },
      { key: "rot", label: "Rotation error", unit: "°", better: "down", values: [31, 31, 26], max: 40 },
    ],
  },
};
