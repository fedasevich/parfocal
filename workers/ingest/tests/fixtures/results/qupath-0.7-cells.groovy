import qupath.lib.roi.ROIs
import qupath.lib.objects.PathObjects
import qupath.lib.regions.ImagePlane

def imageData = getCurrentImageData()
setImageType('BRIGHTFIELD_H_E')
setColorDeconvolutionStains('{"Name" : "H&E default", "Stain 1" : "Hematoxylin", "Values 1" : "0.65111 0.70119 0.29049", "Stain 2" : "Eosin", "Values 2" : "0.2159 0.8012 0.5581", "Background" : " 255 255 255"}')
def roi = ROIs.createRectangleROI(900, 1300, 220, 220, ImagePlane.getDefaultPlane())
def region = PathObjects.createAnnotationObject(roi, getPathClass('Tumor'))
addObject(region)
selectObjects(region)
runPlugin('qupath.imagej.detect.cells.WatershedCellDetection', '{"detectionImageBrightfield":"Hematoxylin OD","requestedPixelSizeMicrons":0.5,"backgroundRadiusMicrons":8.0,"medianRadiusMicrons":0.0,"sigmaMicrons":1.5,"minAreaMicrons":10.0,"maxAreaMicrons":400.0,"threshold":0.1,"maxBackground":2.0,"watershedPostProcess":true,"excludeDAB":false,"cellExpansionMicrons":5.0,"includeNuclei":true,"smoothBoundaries":true,"makeMeasurements":true}')
def cells = getCellObjects()
cells.eachWithIndex { cell, i ->
  def area = cell.getNucleusROI().getArea()
  cell.setPathClass(getPathClass(area > 120 ? 'Tumor' : 'Immune cells'))
}
println("cells: " + cells.size())
exportObjectsToGeoJson(getAllObjects(false), args[0], "FEATURE_COLLECTION")
