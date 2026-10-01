import { Card, PageHead } from "@/components/ui";

export default function About() {
  return (
    <div className="space-y-4 max-w-4xl">
      <PageHead title="About" />
      <Card title="Publication">
        <p className="text-sm">National landslide susceptibility and rainfall-triggering thresholds in India: spatial transferability, inventory bias and machine learning.</p>
        <p className="text-sm text-muted mt-1">Kishan Tiwari · SLATE v1.0.0, <a className="text-accent underline" href="https://doi.org/10.5281/zenodo.23068753">https://doi.org/10.5281/zenodo.23068753</a></p>
      </Card>
      <Card title="About this application"><p className="text-sm">SLATE (Slope Landslide Analytics and Triggering Explorer) is an interactive research platform for landslide susceptibility and rainfall-triggering analysis. It reproduces the paper's models exactly and lets researchers explore where susceptibility is high, how rainfall compares with historical triggering conditions, and how thresholds and machine-learning nowcasts agree. It is not an operational warning service.</p></Card>
      <Card title="Scientific basis"><p className="text-sm">Every map and number is computed from the paper's archived outputs or from its calibrated models applied to the archived IMD rainfall. All computation runs in your browser: the rainfall-event definition, thresholds, SACT, the TRIGRS factor of safety and the six ML models were ported exactly and verified against the paper's Python pipeline (event features and threshold decisions identical; ML scores within 1e-6, with no change in any alert).</p></Card>
      <Card title="Data sources"><p className="text-sm">IMD 0.25° daily gridded rainfall; Copernicus GLO-90 DEM; SoilGrids 2.0; ESA WorldCover 2021; WorldPop 2020; GEM Global Active Faults; USGS ComCat; Generalized Geology of the World; NASA Global Landslide Catalog; Kerala 2018 and Himachal Pradesh 2023 inventories; DataMeet state boundaries; OpenStreetMap basemap.</p></Card>
      <Card title="Model limitations"><ul className="text-sm list-disc pl-4 space-y-1">
        <li>Daily 0.25° rainfall misses sub-daily bursts and orographic detail; during spatially uniform extreme rainfall (Kerala 2018) no method discriminated affected cells.</li>
        <li>The temporal test is dominated by 2013-2016 NASA GLC events; no independent 2017-2025 test exists.</li>
        <li>Catalogue locations are uncertain by up to 25 km and the background contains unreported landslides.</li>
        <li>The two-tier configuration has not been prospectively validated; live rainfall is not connected.</li></ul></Card>
      <Card title="Citation"><p className="text-sm font-mono">Tiwari K (2026) SLATE: Slope Landslide Analytics and Triggering Explorer, version 1.0.0. Zenodo. https://doi.org/10.5281/zenodo.23068753</p></Card>
      <p className="text-xs text-muted">Contact: Kishan Tiwari, kishantiwari@iitkgp.ac.in</p>
    </div>
  );
}
