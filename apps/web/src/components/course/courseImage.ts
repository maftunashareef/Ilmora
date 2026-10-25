export const COURSE_PHOTOGRAPHS: Record<string, string> = {
  // English & IELTS
  'c-general-english': '/images/courses/english-study.jpg',
  'c-ielts': '/images/courses/english-study.jpg',

  // IT & Development
  'c-frontend': '/images/courses/frontend-dev.jpg',
  'c-python': '/images/courses/python-data.jpg',

  // Mathematics
  'c-algebra': '/images/courses/mathematics.jpg',
  'c-olympiad-math': '/images/courses/mathematics.jpg',

  // Sciences
  'c-physics': '/images/courses/science-lab.jpg',
  'c-chemistry': '/images/courses/science-lab.jpg',

  // World Languages
  'c-german': '/images/courses/world-languages.jpg',
  'c-korean': '/images/courses/world-languages.jpg',

  // University Prep
  'c-dtm': '/images/courses/university-prep.jpg',
  'c-sat': '/images/courses/university-prep.jpg',

  // Furniture & Craftsmanship
  'c-bazis': '/images/courses/furniture-craft.jpg',
  'c-restoration': '/images/courses/furniture-craft.jpg',

  // Interior Design
  'c-interior': '/images/courses/interior-design.jpg',
  'c-3d-interior': '/images/courses/interior-design.jpg',
}

export const CATEGORY_PHOTOGRAPHS: Record<string, string> = {
  'cat-english': '/images/courses/english-study.jpg',
  'cat-it': '/images/courses/frontend-dev.jpg',
  'cat-furniture': '/images/courses/furniture-craft.jpg',
  'cat-design': '/images/courses/interior-design.jpg',
  'cat-math': '/images/courses/mathematics.jpg',
  'cat-sciences': '/images/courses/science-lab.jpg',
  'cat-languages': '/images/courses/world-languages.jpg',
  'cat-university': '/images/courses/university-prep.jpg',
}

export function getCoursePhotoUrl(course: {
  id: string
  categoryId?: string
  imageUrl?: string
  imageUpload?: { previewUrl?: string }
}): string {
  if (course.imageUpload?.previewUrl) return course.imageUpload.previewUrl
  if (course.imageUrl) return course.imageUrl
  if (COURSE_PHOTOGRAPHS[course.id]) return COURSE_PHOTOGRAPHS[course.id]
  if (course.categoryId && CATEGORY_PHOTOGRAPHS[course.categoryId]) return CATEGORY_PHOTOGRAPHS[course.categoryId]
  return '/images/courses/english-study.jpg'
}
