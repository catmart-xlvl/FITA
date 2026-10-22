# Editable tutorial source

The English downloadable guide is [FITA-Tutorial.pdf](../FITA-Tutorial.pdf). It starts with a practical orientation and linked contents, with no promotional cover.

`build_tutorial.py` contains the editable text, page order and layout. Images are read from `../media`; no personal project files are needed.

To rebuild with Python 3, ReportLab and Pillow installed:

```text
python docs/tutorial/build_tutorial.py
```

Run this from the repository root. The script also works from another working directory when called by its full path. It writes `docs/FITA-Tutorial.pdf`.

Before publishing an edited guide, render every page and check the layout, readability, page numbers, contents links and current application control names. Keep software validation, artistic approval and real target-client tests distinct. The source describes FITA 0.1.0; external providers can change.
