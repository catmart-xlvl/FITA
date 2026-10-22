// Shared expression identifiers; bindings may span several rendered primitives.
export const facialExpressions=[
  'blink','blinkLeft','blinkRight','lookLeft','lookRight','lookUp','lookDown',
  'browUp','browDown','browAngry','browSad','smile','frown',
  ...['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','ih','oh','ou'].map(v=>'vrc.v_'+v)
];
export const facialProfile='anime-face-v1';

// Engineering limits for optional blink retreat, in glTF metres. These are
// safety ceilings, not a displacement to apply to every character.
export const blinkEyePolicy=Object.freeze({
  maximumRetractionMetres:.001,
  maximumRetractionDiameterRatio:.05,
  rigidityRelativeTolerance:1e-5,
  absoluteToleranceMetres:1e-7,
  minimumInwardAlignment:.98,
});
