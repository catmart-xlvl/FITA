// Places observed in signed-in Tripo Studio (EN/ES) on 2026-10-21.
// Background-side single source. Page functions run serialized in the tab and
// cannot import it, so they embed STUDIO_ROUTE_GROUP literally; a test keeps
// those copies identical to this one.
export const STUDIO_ORIGIN='https://studio.tripo3d.ai';
export const STUDIO_WORKSPACES=Object.freeze(['generate-image','generate','segmentation','fill-parts','retopology','smart-uv','texture','texture-edit','texture-upscale','texture-pbr','rigging','animate']);
export const STUDIO_ROUTE_GROUP='generate-image|generate|segmentation|fill-parts|retopology|smart-uv|texture-edit|texture-upscale|texture-pbr|texture|rigging|animate';
const UUID=/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const LOCALE='(?:([a-z]{2}(?:-[A-Za-z]{2,4})?)/)?';
const WORKSPACE_PATH=new RegExp(`^/${LOCALE}workspace/(${STUDIO_ROUTE_GROUP})(?:/([^/]+))?/?$`);

// Where a Studio URL points. Asset IDs are read from observed URLs only; a
// slug without a UUID never becomes an identity.
export function parseStudioUrl(value){
 let url;try{url=new URL(value);}catch{return {page:'invalid'};}
 if(url.origin!==STUDIO_ORIGIN||url.username||url.password)return {page:'outside'};
 const workspace=url.pathname.match(WORKSPACE_PATH);
 if(workspace)return {page:'workspace',locale:workspace[1]||null,workspace:workspace[2],taskId:workspace[3]?.match(UUID)?.[1]?.toLowerCase()||null,slug:workspace[3]||null,clean:!url.search&&!url.hash};
 const locale=url.pathname.match(new RegExp(`^/${LOCALE}(assets)?/?$`));
 if(locale)return {page:locale[2]?'assets':'home',locale:locale[1]||null,clean:!url.search&&!url.hash};
 return {page:'other',clean:!url.search&&!url.hash};
}
export const isStudioWorkspace=workflow=>STUDIO_WORKSPACES.includes(workflow);
