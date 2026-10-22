import {WebGLRenderTarget,HalfFloatType,Vector2,Color,Scene,OrthographicCamera,Mesh,PlaneGeometry,ShaderMaterial} from 'three';

// Dilate only the union of rendered model coverage. No depth/normal/triangle
// edge detection: overlapping hair, face and clothing never acquire inner lines.
// Outline (1.7 px) with a subtle fixed contrast/saturation grade.
export function silhouettePreview(renderer){
  const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,samples:4});
  const size=new Vector2(),clear=new Color(),scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1);
  const material=new ShaderMaterial({transparent:true,premultipliedAlpha:true,depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{image:{value:target.texture},texel:{value:new Vector2(1,1)},width:{value:1},ink:{value:new Color(0x141414)}},
    vertexShader:'varying vec2 uvScreen; void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`uniform sampler2D image; uniform vec2 texel; uniform float width; uniform vec3 ink; varying vec2 uvScreen;
      void main(){
        vec4 center=texture2D(image,uvScreen); float coverage=center.a;
        // Two rings of 12 taps: a thicker, unbroken anime outline around the silhouette only.
        for(int i=0;i<12;i++){
          float angle=float(i)*0.52359877559;
          vec2 dir=vec2(cos(angle),sin(angle))*texel*width;
          coverage=max(coverage,texture2D(image,uvScreen+dir).a);
          coverage=max(coverage,texture2D(image,uvScreen+dir*.5).a);
        }
        float line=max(0.0,coverage-center.a)*.92;
        float alpha=center.a+line;
        vec3 rgb=(center.rgb+ink*line)/max(alpha,.000001);
        gl_FragColor=vec4(rgb,alpha);
        #include <colorspace_fragment>
        // Subtle fixed grade on the character only (display space): +8% saturation, +6% contrast.
        vec3 graded=gl_FragColor.rgb;
        float luma=dot(graded,vec3(.2126,.7152,.0722));
        graded=mix(vec3(luma),graded,1.08);
        graded=(graded-.5)*1.06+.5;
        gl_FragColor.rgb=clamp(graded,0.0,1.0);
        gl_FragColor.rgb*=gl_FragColor.a;
      }`});
  const quad=new Mesh(new PlaneGeometry(2,2),material);scene.add(quad);
  return {
    render(world,view,model,helpers){
      renderer.getDrawingBufferSize(size);
      if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
      material.uniforms.texel.value.set(1/size.x,1/size.y);
      material.uniforms.width.value=1.7*renderer.getPixelRatio(); // ~1.7 CSS px anime outline
      const previousTarget=renderer.getRenderTarget(),background=world.background,autoClear=renderer.autoClear;
      const helperVisibility=helpers.map(o=>o.visible),modelVisible=model.visible;
      renderer.getClearColor(clear);const alpha=renderer.getClearAlpha();
      try{
        helpers.forEach(o=>o.visible=false);world.background=null;
        renderer.setRenderTarget(target);renderer.setClearColor(0x000000,0);renderer.autoClear=true;
        renderer.render(world,view);
        renderer.setRenderTarget(previousTarget);world.background=background;
        helpers.forEach((o,i)=>o.visible=helperVisibility[i]);model.visible=false;
        renderer.render(world,view);
        renderer.autoClear=false;renderer.render(scene,camera);
      }finally{
        model.visible=modelVisible;world.background=background;helpers.forEach((o,i)=>o.visible=helperVisibility[i]);
        renderer.autoClear=autoClear;renderer.setRenderTarget(previousTarget);renderer.setClearColor(clear,alpha);
      }
    },
    dispose(){target.dispose();quad.geometry.dispose();material.dispose();}
  };
}
