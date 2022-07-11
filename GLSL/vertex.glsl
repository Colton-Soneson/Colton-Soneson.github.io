attribute vec4 aVertexPos;
uniform mat4 uMV_Matrix;
uniform mat4 uProj_Matrix;

void main() 
{
	gl_Position = uProj_Matrix * uMV_Matrix * aVertexPos;
};
