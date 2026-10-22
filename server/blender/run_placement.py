"""Portable entry point: Blender --background --disable-autoexec --python run_placement.py."""
import json, sys
from pathlib import Path
script_dir=Path(__file__).resolve().parent
root=Path(sys.argv[sys.argv.index('--')+1]).resolve() if '--' in sys.argv else script_dir
sys.path.insert(0,str(script_dir))
import place_parts
settings=json.loads((root/'settings.json').read_text(encoding='utf-8')) if (root/'settings.json').exists() else {'scale':1,'offset':[0,0,0],'rotation':[0,0,0],'headNeck':None,'bodyNeck':None}
job={name:str(root/file) for name,file in [('head','head.glb'),('body','body.glb'),('blend','placed.blend'),('glb','placed.glb'),('report','report.json')]}
job['settings']=settings
filename=root/'job.json';filename.write_text(json.dumps(job),encoding='utf-8')
sys.argv=['run_placement.py','--',str(filename)]
place_parts.main()
